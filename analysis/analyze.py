"""Audio analysis for the MV.

Decodes the song with ffmpeg, then derives:
  * a fixed-tempo beat grid (tempo + phase fitted to the onset envelope)
  * per-frame band energies (sub / low / mid / high) and overall loudness
  * kick / snare / hat onset times

Output: data/analysis.json (consumed by the renderer at runtime).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import find_peaks

ROOT = Path(__file__).resolve().parent.parent
SONG = ROOT / "world.execute(me); - Mili.mp3"
OUT = ROOT / "data" / "analysis.json"

SR = 22050
HOP = 256            # ~11.6 ms
NFFT = 2048
FPS_OUT = 60         # resolution of exported envelopes


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "-"],
        check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def stft_mag(y: np.ndarray) -> np.ndarray:
    win = np.hanning(NFFT).astype(np.float32)
    pad = np.pad(y, (NFFT // 2, NFFT // 2))
    n = 1 + (len(pad) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    frames = pad[idx] * win
    return np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32)


def band(mag, freqs, lo, hi):
    sel = (freqs >= lo) & (freqs < hi)
    return mag[:, sel].sum(axis=1)


def flux(mag, freqs, lo, hi):
    sel = (freqs >= lo) & (freqs < hi)
    m = np.log1p(100 * mag[:, sel])
    d = np.diff(m, axis=0, prepend=m[:1])
    return np.maximum(d, 0).sum(axis=1)


def norm(x, pct=99.5):
    x = x - np.percentile(x, 2)
    x = np.clip(x / (np.percentile(x, pct) + 1e-9), 0, 1)
    return x


def fit_grid(onset: np.ndarray, frame_t: np.ndarray, bpm_lo=126, bpm_hi=134):
    """Search tempo + phase maximising the onset energy sampled on the grid."""
    best = (-1, None, None)
    dur = frame_t[-1]
    for bpm in np.arange(bpm_lo, bpm_hi, 0.005):
        period = 60.0 / bpm
        phases = np.linspace(0, period, 120, endpoint=False)
        beats = np.arange(0, dur / period)[None, :] * period + phases[:, None]
        fi = np.clip(np.round(beats / (HOP / SR)).astype(int), 0, len(onset) - 1)
        score = onset[fi].sum(axis=1)
        k = int(np.argmax(score))
        if score[k] > best[0]:
            best = (score[k], bpm, phases[k])
    return best[1], best[2]


def main():
    y = decode(SONG)
    duration = len(y) / SR
    mag = stft_mag(y)
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    frame_t = np.arange(mag.shape[0]) * HOP / SR

    sub = band(mag, freqs, 20, 90)
    low = band(mag, freqs, 90, 300)
    mid = band(mag, freqs, 300, 2500)
    high = band(mag, freqs, 5000, 11000)
    rms = np.sqrt(uniform_filter1d(
        np.pad(y, (0, HOP * mag.shape[0] - len(y) + HOP))[: HOP * mag.shape[0]]
        .reshape(-1, HOP) ** 2, 1, axis=0).mean(axis=1))

    on_all = flux(mag, freqs, 30, 11000)
    on_kick = flux(mag, freqs, 30, 150)
    on_snare = flux(mag, freqs, 1500, 5000)
    on_hat = flux(mag, freqs, 7000, 11000)

    onset = norm(on_all)
    bpm, phase = fit_grid(onset, frame_t)
    period = 60.0 / bpm

    # Downbeat: choose the beat offset (mod 4) whose beats carry the most kick energy.
    kick_n = norm(on_kick)
    beats = np.arange(phase, duration, period)
    fi = np.clip(np.round(beats / (HOP / SR)).astype(int), 0, len(kick_n) - 1)
    bar_scores = [kick_n[fi[o::4]].mean() for o in range(4)]
    down_off = int(np.argmax(bar_scores))

    # Local drift check: best phase per 16-beat window, relative to the global grid.
    drift = []
    for w0 in range(0, len(beats) - 16, 16):
        bt = beats[w0:w0 + 16]
        offs = np.linspace(-0.06, 0.06, 49)
        sc = []
        for o in offs:
            ii = np.clip(np.round((bt + o) / (HOP / SR)).astype(int), 0, len(onset) - 1)
            sc.append(onset[ii].sum())
        drift.append(float(offs[int(np.argmax(sc))]))

    def picks(env, thr, min_gap_s):
        e = norm(env)
        loc = uniform_filter1d(e, int(0.5 * SR / HOP))
        pk, _ = find_peaks(e, height=np.maximum(thr, loc * 1.6),
                           distance=max(1, int(min_gap_s * SR / HOP)))
        return [round(float(frame_t[p]), 4) for p in pk], [round(float(e[p]), 3) for p in pk]

    kick_t, kick_v = picks(on_kick, 0.28, 0.18)
    snare_t, snare_v = picks(on_snare, 0.30, 0.18)
    hat_t, hat_v = picks(on_hat, 0.35, 0.08)

    # Resample envelopes to FPS_OUT with light smoothing (peak-hold for punch).
    out_t = np.arange(0, duration, 1 / FPS_OUT)

    def env(x, smooth=3):
        x = maximum_filter1d(x, smooth)
        x = norm(x)
        return [round(float(v), 3) for v in np.interp(out_t, frame_t, x)]

    loud = norm(uniform_filter1d(rms, int(0.4 * SR / HOP)))
    data = {
        "duration": round(duration, 4),
        "bpm": round(float(bpm), 4),
        "beatPeriod": round(float(period), 6),
        "firstBeat": round(float(phase), 4),
        "downbeatOffset": down_off,
        "drift16": drift,
        "fps": FPS_OUT,
        "env": {
            "sub": env(sub), "low": env(low), "mid": env(mid), "high": env(high),
            "onset": env(on_all, 2),
            "loud": [round(float(v), 3) for v in np.interp(out_t, frame_t, loud)],
        },
        "kicks": {"t": kick_t, "v": kick_v},
        "snares": {"t": snare_t, "v": snare_v},
        "hats": {"t": hat_t, "v": hat_v},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))

    print(f"duration {duration:.3f}s  bpm {bpm:.3f}  period {period:.5f}  first beat {phase:.4f}  downbeat offset {down_off}")
    print("bar scores", [round(float(s), 3) for s in bar_scores])
    print("drift per 16 beats (ms):", [int(d * 1000) for d in drift])
    print(f"kicks {len(kick_t)}  snares {len(snare_t)}  hats {len(hat_t)}")
    # Coarse loudness map, 2 s per cell, to locate sections.
    cells = [loud[(frame_t >= s) & (frame_t < s + 2)].mean() for s in np.arange(0, duration, 2)]
    print("loudness/2s:", " ".join(f"{int(c * 9)}" for c in cells))
    lowc = [norm(sub + low)[(frame_t >= s) & (frame_t < s + 2)].mean() for s in np.arange(0, duration, 2)]
    print("bass/2s:    ", " ".join(f"{int(min(c * 3, 1) * 9)}" for c in lowc))


if __name__ == "__main__":
    sys.exit(main())
