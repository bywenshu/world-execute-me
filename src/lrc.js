// Parser for word-timed bilingual LRC ("[mm:ss.xx]<mm:ss.xx>word <mm:ss.xx>word<mm:ss.xx>").
// Lines sharing a timestamp are paired: the one containing CJK text is the translation.

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const TIME = /<(\d+):(\d+(?:\.\d+)?)>/;

const toSec = (m, s) => Number(m) * 60 + Number(s);

function parseBody(body) {
  const parts = body.split(new RegExp(TIME.source, 'g'));
  // parts: [pre, mm, ss, text, mm, ss, text, ..., mm, ss, tail]
  const tokens = [];
  let end = null;
  for (let i = 1; i + 1 < parts.length; i += 3) {
    const t = toSec(parts[i], parts[i + 1]);
    const text = parts[i + 2] ?? '';
    if (text.length) tokens.push({ t, text });
    else end = t;
  }
  if (!tokens.length && parts[0].trim()) tokens.push({ t: null, text: parts[0] });
  return { tokens, end };
}

export function parseLRC(src) {
  const meta = {};
  const raw = [];
  for (const line of src.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const tm = s.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (tm) {
      const start = toSec(tm[1], tm[2]);
      const { tokens, end } = parseBody(tm[3]);
      const text = tokens.map((k) => k.text).join('');
      raw.push({ start, end: end ?? start, tokens, text });
      continue;
    }
    const mm = s.match(/^\[([a-zA-Z]+):(.*)\]$/);
    if (mm) meta[mm[1]] = mm[2].trim();
  }

  // Pair lines by identical start time.
  const groups = [];
  for (const r of raw) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.start - r.start) < 1e-3) g.items.push(r);
    else groups.push({ start: r.start, items: [r] });
  }

  const header = [];
  const lines = [];
  for (const g of groups) {
    const en = g.items.find((r) => !CJK.test(r.text)) ?? g.items[0];
    const zh = g.items.find((r) => r !== en && CJK.test(r.text));
    // Credits / title rows are squeezed into a few hundredths of a second.
    if (en.end - en.start < 0.2 && !zh) {
      header.push(en.text.trim());
      continue;
    }
    const words = en.tokens.map((k, i) => {
      const t = k.t ?? en.start;
      const next = en.tokens[i + 1]?.t ?? en.end;
      return { t, end: Math.max(next, t + 0.05), text: k.text };
    });
    // Character offsets of each token inside the concatenated line text.
    let off = 0;
    for (const w of words) {
      w.c0 = off;
      off += w.text.length;
      w.c1 = off;
    }
    const zhText = zh ? zh.text.trim() : '';
    const zhTokens = zhText.split(/\s+/).filter(Boolean);
    const enWords = words.filter((w) => w.text.trim());
    lines.push({
      index: lines.length,
      start: en.start,
      end: en.end,
      en: en.text.replace(/\s+$/, ''),
      zh: zhText,
      zhEnd: zh ? zh.end : en.end,
      words,
      // When the translation splits into as many tokens as there are words, map them 1:1.
      zhPerWord: zhTokens.length > 1 && zhTokens.length === enWords.length ? zhTokens : null,
    });
  }
  return { meta, header, lines };
}

export class Lyrics {
  constructor(parsed) {
    Object.assign(this, parsed);
    this.starts = this.lines.map((l) => l.start);
    this.allWords = this.lines.flatMap((l) => l.words.filter((w) => w.text.trim()).map((w) => ({ ...w, line: l.index })));
  }

  /** Index of the line currently being sung (or last sung), -1 before the first line. */
  lineAt(t) {
    let lo = 0, hi = this.starts.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.starts[m] <= t) lo = m + 1;
      else hi = m;
    }
    return lo - 1;
  }

  wordsBetween(a, b) {
    return this.allWords.filter((w) => w.t >= a && w.t < b);
  }
}
