// Renders index.html over http with headless Chromium.
//   node render.mjs beats  [dir]   a frame on every beat (t = 0, 0.5, ... DUR)
//   node render.mjs frames [dir]   every frame at 60 fps (t = i / 60, DUR * 60 frames)
//   node render.mjs audio          writes audio.wav
//   node render.mjs at <t> <file>  one frame
// Env: PW_NODE_MODULES (folder holding playwright-core), CHROMIUM (browser binary).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PW_NODE_MODULES ? path.join(process.env.PW_NODE_MODULES, 'x.js') : import.meta.url);
const { chromium } = require('playwright-core');

const [mode = 'beats', arg1, arg2] = process.argv.slice(2);
const port = 8000 + Math.floor(Math.random() * 1000);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });

try {
  const url = `http://127.0.0.1:${port}/index.html`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i > 50) throw new Error('server did not start');
    await new Promise(r => setTimeout(r, 100));
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForFunction(() => window.ready === true);
  const dur = await page.evaluate(() => DUR);
  const shot = async (t, file) => {
    await page.evaluate(t => window.seek(t), t);
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  };

  if (mode === 'beats') {
    const dir = path.resolve(arg1 ?? path.join(here, 'beats'));
    fs.mkdirSync(dir, { recursive: true });
    for (let b = 0; b <= dur * 2; b++) {
      const t = b * 0.5;
      await shot(t, path.join(dir, `beat-${String(b).padStart(2, '0')}-${t.toFixed(2)}s.png`));
    }
  } else if (mode === 'frames') {
    const dir = path.resolve(arg1 ?? path.join(here, 'frames'));
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < dur * 60; i++) {
      await shot(i / 60, path.join(dir, `f${String(i).padStart(4, '0')}.png`));
      if (i % 60 === 0) console.log(`frame ${i}`);
    }
  } else if (mode === 'audio') {
    const b64 = await page.evaluate(() => window.renderAudio());
    fs.writeFileSync(path.join(here, 'audio.wav'), Buffer.from(b64, 'base64'));
  } else if (mode === 'at') {
    await shot(Number(arg1), path.resolve(arg2));
  }
  await browser.close();
} finally {
  server.kill();
}
