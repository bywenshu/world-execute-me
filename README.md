# world.execute(me);

一套给歌曲 *world.execute(me);*（Mili）用的原创可视化程序：16,384 个粒子在 WebGL2 里按节拍变形，双语歌词从 LRC 逐词读入。浏览器里可以实时播放，也可以逐帧导出 1080p60 的 MP4。

An original visualizer for *world.execute(me);* by Mili. Sixteen thousand particles morph on a beat grid in WebGL2, and bilingual lyrics are read word by word from an LRC file. Play it live in a browser, or export a 1080p60 MP4 frame by frame.

程序版权 © 2026 BYWENSHU，以 [MIT License](LICENSE) 授权。歌曲录音和歌词不属于这份许可，仓库里也不包含它们。完整说明见 [版权](#版权--copyright)。

Software copyright © 2026 BYWENSHU, under the [MIT License](LICENSE). The recording and the lyrics are not covered by that license and are not in this repository. See [Copyright](#版权--copyright).

## 本地运行

需要 Node.js 18 或更新版本。导出和音频分析还需要本机的 `ffmpeg`。实时播放用任意支持 WebGL2 的浏览器。

### 1. 准备歌曲文件

把你合法取得的文件放在仓库根目录，文件名必须是：

```text
world.execute(me); - Mili.mp3
world.execute(me); - Mili.lrc
```

LRC 需要带逐词时间戳。这两个文件已在 `.gitignore` 里，不会被提交。

### 2. 安装并播放

```bash
npm install
npm run serve
```

打开 <http://localhost:8130/>。点击画面或按 Enter 开始。

| 键 | 作用 |
| --- | --- |
| Space | 暂停 / 继续 |
| ← / → | 后退 / 前进 5 秒 |
| Shift + ← / → | 后退 / 前进 1 秒 |
| F | 全屏 |

地址栏可以加 `?t=60` 从第 60 秒开始。拖动进度需要服务端支持 Range，`serve.mjs` 已经处理了这一点。

### 3. 重新分析节拍（可选）

`data/analysis.json` 已经提交，里面是 BPM、相位、底鼓 / 军鼓 / 踩镲时间和频段能量，不含音频。换了一份音频才需要重算：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run analyze
```

Python 3.9 及以上。分析脚本用 ffmpeg 把歌曲解码成 22050 Hz 单声道，再用 NumPy / SciPy 拟合节拍网格。

### 4. 导出视频

导出不跟墙钟走。Playwright 拉起 Chrome for Testing，每一帧调用 `renderFrame(t)`，JPEG 流直接送进 ffmpeg，再和 MP3 合成。

```bash
npx --yes playwright@1.56 install chromium
npm run export
```

成片写到 `out/world.execute(me).mp4`（默认 1920×1080、60 fps、H.264 CRF 16、AAC 320 kbps、BT.709 有限范围）。`out/` 已被忽略。

脚本会在 `~/Library/Caches/ms-playwright/` 里找 Chrome for Testing。浏览器在别的路径时：

```bash
CHROME="/path/to/Google Chrome for Testing" npm run export
```

常用参数：

```bash
node export/export.mjs --from 60 --to 70 --w 1280 --fps 60 --crf 18 --preset veryfast --out out/clip.mp4
```

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| `--from` / `--to` | `0` / 歌曲结尾 | 导出区间（秒） |
| `--w` | `1920` | 宽度，高度按 16:9 |
| `--fps` | `60` | 帧率 |
| `--crf` | `16` | H.264 质量，数值越小越清晰 |
| `--preset` | `slow` | x264 预设 |
| `--out` | `out/world.execute(me).mp4` | 输出路径 |

抽静止帧（先预热拖影再截图）：

```bash
npm run stills -- 16 60.5 186.8
```

图片写到 `out/stills/`。

## Run locally

You need Node.js 18 or newer. Export and audio analysis also need `ffmpeg` on your PATH. Live playback needs any browser with WebGL2.

### 1. Add the song files

Place copies you obtained legally in the repository root. The names must be exactly:

```text
world.execute(me); - Mili.mp3
world.execute(me); - Mili.lrc
```

The LRC file needs word-level timestamps. Both names are listed in `.gitignore` and are not part of the commit.

### 2. Install and play

```bash
npm install
npm run serve
```

Open <http://localhost:8130/>. Click the stage or press Enter to start.

| Key | Action |
| --- | --- |
| Space | Pause / resume |
| ← / → | Seek by 5 seconds |
| Shift + ← / → | Seek by 1 second |
| F | Full screen |

Append `?t=60` to start at 60 seconds. Seeking uses HTTP Range requests, which `serve.mjs` supports.

### 3. Rebuild the beat analysis (optional)

`data/analysis.json` is already in the repo: BPM, phase, kick / snare / hat times, and band energy. It does not contain audio. Rebuild it only when the audio file changes:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run analyze
```

Python 3.9 or newer. The script asks ffmpeg to decode the song to 22050 Hz mono, then fits a beat grid with NumPy and SciPy.

### 4. Export a video

Export is deterministic. Playwright launches Chrome for Testing, calls `renderFrame(t)` once per frame, and pipes JPEGs into ffmpeg, which muxes them with the MP3.

```bash
npx --yes playwright@1.56 install chromium
npm run export
```

The file is written to `out/world.execute(me).mp4` (default 1920×1080, 60 fps, H.264 CRF 16, AAC 320 kbps, BT.709 limited range). The `out/` directory is gitignored.

The exporter looks for Chrome for Testing under `~/Library/Caches/ms-playwright/`. If the binary lives elsewhere:

```bash
CHROME="/path/to/Google Chrome for Testing" npm run export
```

A shorter, faster encode:

```bash
node export/export.mjs --from 60 --to 70 --w 1280 --fps 60 --crf 18 --preset veryfast --out out/clip.mp4
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--from` / `--to` | `0` / end of song | Range in seconds |
| `--w` | `1920` | Width; height follows 16:9 |
| `--fps` | `60` | Frame rate |
| `--crf` | `16` | H.264 quality; lower is sharper |
| `--preset` | `slow` | x264 preset |
| `--out` | `out/world.execute(me).mp4` | Output path |

Still frames, with a short trail warm-up:

```bash
npm run stills -- 16 60.5 186.8
```

Images land in `out/stills/`.

## 程序是怎么串起来的

- `analysis/analyze.py` 离线写出 `data/analysis.json`。
- `src/lrc.js` 在运行时解析 LRC。`src/director.js` 用节拍和词时间决定形状、镜头、闪光和字幕模式。
- `src/shapes.js` 用公式生成形状。`src/particles.js` 在形状之间插值。`src/renderer.js` 做 WebGL2 绘制、拖影、泛光和 CRT。
- `src/overlay.js` 用 Canvas 2D 画歌词和 HUD。
- `serve.mjs` 是不依赖第三方包的静态服务器。`export/export.mjs` 负责逐帧出片。

## How the pieces fit

- `analysis/analyze.py` writes `data/analysis.json` offline.
- `src/lrc.js` parses the LRC at runtime. `src/director.js` turns beats and word times into shapes, cameras, flashes, and lyric modes.
- `src/shapes.js` builds shapes from formulas. `src/particles.js` interpolates between them. `src/renderer.js` is the WebGL2 pass: particles, trails, bloom, CRT.
- `src/overlay.js` draws lyrics and the HUD on a Canvas 2D layer.
- `serve.mjs` is a dependency-free static server. `export/export.mjs` renders the file frame by frame.

## 版权 / Copyright

### 本仓库的程序 / This software

Copyright (c) 2026 BYWENSHU

可视化程序的源代码以 MIT License 授权，见 [LICENSE](LICENSE)。你可以按该许可使用、修改和再分发这些代码。许可的免责声明同样适用。

The visualizer source is released under the MIT License. See [LICENSE](LICENSE). You may use, modify, and redistribute that code under those terms, including the disclaimer.

### 音乐与歌词 / Music and lyrics

*world.execute(me);*，演唱：Mili。

作曲、歌词和录音的版权属于各自的权利人。MIT License 不覆盖这些作品。本仓库不包含 MP3、LRC，也不包含已经混入这首录音的成片。请只使用你有权播放的副本，在本地运行和导出。把成片公开分发，需要另行取得录音和歌词权利人的许可。

*world.execute(me);*, performed by Mili.

The composition, the lyrics, and the sound recording remain the property of their rights holders. The MIT License does not apply to them. This repository does not contain the MP3, the LRC, or a finished video that muxes the recording. Use a copy you are allowed to play, and run or export it on your own machine. Publishing that video needs separate permission from the holders of the recording and the lyrics.

### 字体 / Font

界面使用 [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) 的子集（`assets/fonts/*.woff2`）。

Copyright 2020 The JetBrains Mono Project Authors. Licensed under the SIL Open Font License, Version 1.1. The full text is in [assets/fonts/OFL.txt](assets/fonts/OFL.txt).

第三方作品的汇总也写在 [NOTICE](NOTICE)。
