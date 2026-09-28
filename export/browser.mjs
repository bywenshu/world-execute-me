import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from '../serve.mjs';

function findChrome() {
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const p = path.join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export async function openMV({ width = 1920, height = 1080, port = 8131 } = {}) {
  const server = await serve(port);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || findChrome(),
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/?export=1&w=${width}&h=${height}`);
  await page.waitForFunction(() => window.__mvReady || window.__mvError, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__mvError);
  if (err) throw new Error(err);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  const duration = await page.evaluate(() => window.__mv.duration);
  return {
    page, gpu, duration,
    async close() { await browser.close(); server.close(); },
  };
}
