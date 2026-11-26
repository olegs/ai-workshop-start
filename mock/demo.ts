#!/usr/bin/env node
// Records a short demo of the web view over the mock data: `npm run demo`, into docs/demo.mp4, or the path given.
// Chromium plays a person: the mouse glides to the field, the words are typed a key at a time, each result is read.
// At most 10 seconds. Needs Chromium for Playwright (`npx playwright install --with-deps chromium`) and ffmpeg.
// Change DEMO below to show what a pull request changes in the page.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createWebServer } from '../src/web.ts';
import { mockGitHub } from './github.ts';

/** The longest a demo may be, in seconds. */
export const MAX_SECONDS = 10;
const SIZE = { width: 1280, height: 720 };

/** What a person does on the page; `human` moves, clicks and types like one. */
async function DEMO(page: Page, human: Human) {
  await human.pause(600);
  await human.click('#repo');
  await human.type('JetBrains/kotlin');
  await human.pause(300);
  await human.click('#scan');
  await page.locator('#skills .skill').first().waitFor();
  await human.pause(1500); // reading the skills
  await human.click('#filter');
  await human.type('gradle');
  await human.pause(1800); // reading what matched
}

type Human = ReturnType<typeof human>;

/** Moves, clicks and types like a person: eased mouse paths, a pause before a click, keys at an uneven pace. */
function human(page: Page) {
  let x = SIZE.width / 2;
  let y = SIZE.height - 120;
  const pause = (ms: number) => page.waitForTimeout(ms);
  async function moveTo(toX: number, toY: number) {
    const fromX = x;
    const fromY = y;
    const steps = 24;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const arc = Math.sin(Math.PI * t) * 30; // a slight curve, as a hand moves
      x = fromX + (toX - fromX) * eased;
      y = fromY + (toY - fromY) * eased - arc;
      await page.mouse.move(x, y);
      await page.waitForTimeout(16);
    }
  }
  return {
    pause,
    moveTo,
    /** Glides to the element, a little left of its middle, and clicks it. */
    async click(selector: string) {
      const box = await page.locator(selector).boundingBox();
      if (!box) throw new Error(`Not on the page: ${selector}`);
      await moveTo(box.x + box.width * 0.4, box.y + box.height / 2);
      await pause(150);
      await page.mouse.down();
      await pause(70);
      await page.mouse.up();
    },
    /** Types into the focused field, a key at a time; the same pace every time, so every demo is the same. */
    async type(text: string) {
      const pace = [95, 70, 120, 80, 65, 110, 90];
      for (const [index, key] of [...text].entries()) {
        await page.keyboard.type(key);
        await pause(key === '/' ? 220 : pace[index % pace.length]);
      }
    },
  };
}

/** A cursor drawn in the page: the video does not show the system's. */
const CURSOR = `
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;' +
      'transform:translate(640px,600px);transition:scale .08s;';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" ' +
      'fill="#16161d" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    addEventListener('mousemove', (event) => (cursor.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)'), true);
    addEventListener('mousedown', () => (cursor.style.scale = '0.82'), true);
    addEventListener('mouseup', () => (cursor.style.scale = '1'), true);
  });
`;

/** Records DEMO into `output`, an MP4 of at most MAX_SECONDS; the seconds it lasts. */
export async function recordDemo(output: string): Promise<number> {
  const server = createWebServer({ fetch: mockGitHub(150) });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const videos = mkdtempSync(join(tmpdir(), 'skill-atlas-demo-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: SIZE,
      colorScheme: 'light',
      recordVideo: { dir: videos, size: SIZE },
    });
    await context.addInitScript(CURSOR);
    const page = await context.newPage();
    const opened = Date.now();
    await page.goto(base);
    await page.locator('#repo').waitFor();
    const started = Date.now();
    await DEMO(page, human(page));
    const seconds = (Date.now() - started) / 1000;
    const video = page.video();
    await context.close();
    if (!video) throw new Error('No video recorded');
    if (seconds > MAX_SECONDS) throw new Error(`The demo lasts ${seconds.toFixed(1)} s, more than ${MAX_SECONDS} s: shorten DEMO`);
    mkdirSync(dirname(output), { recursive: true });
    // From the loaded page on, without the blank page before it; H.264, so GitHub and every player play it.
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', ((started - opened) / 1000).toFixed(2), '-i', await video.path(),
      '-t', String(MAX_SECONDS), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', output,
    ]);
    return Math.min(seconds, MAX_SECONDS);
  } finally {
    await browser.close();
    server.close();
    rmSync(videos, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? fileURLToPath(new URL('../docs/demo.mp4', import.meta.url)));
  const seconds = await recordDemo(output);
  console.log(`${output}: ${seconds.toFixed(1)} s`);
}
