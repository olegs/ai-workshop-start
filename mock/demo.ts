#!/usr/bin/env node
// Records a short demo of the web view over the mock data: `npm run demo`, into docs/demo.mp4, or the path given,
// and its animated GIF preview next to it, docs/demo.gif: the pull request shows the GIF, as GitHub plays no MP4 there.
// Chromium plays a person: the mouse glides to the field, the words are typed a key at a time, each result is read.
// At most 20 seconds. Needs Chromium for Playwright (`npx playwright install --with-deps chromium`) and ffmpeg.
// Change DEMO below to show what a pull request changes in the page.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from 'playwright';
import { createWebServer } from '../src/web.ts';
import { mockGitHub } from './github.ts';

/** The longest a demo may be, in seconds. */
export const MAX_SECONDS = 20;
const SIZE = { width: 1280, height: 720 };
/** The GIF preview: narrower and fewer frames than the video, so it stays well under a megabyte. */
export const PREVIEW = { width: 960, fps: 12 };

/** Where the GIF preview of the video at `output` goes: next to it, the same name, `.gif`. */
export function previewPath(output: string): string {
  return output.slice(0, output.length - extname(output).length) + '.gif';
}

/** What a person does on the page; `human` moves, clicks and types like one. */
async function DEMO(page: Page, human: Human) {
  await human.pause(500);
  await human.click('#repo');
  await human.type('JetBrains');
  await human.click('#scan');
  await page.locator('#repositories .skill').first().waitFor();
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await human.pause(700); // the repositories, their skills, the Cluster button by the filter
  await human.click('#cluster');
  await page.locator('#cluster-map .scatterlayer .point').first().waitFor();
  await human.scroll(330); // the map in full: similar skills close together, each group in its colour
  await human.pause(1100);
  // A point of each group hovered: its skill, its repository, what it does.
  await human.hover(page.locator('#cluster-map .scatterlayer .trace').nth(0).locator('.point').nth(0));
  await human.pause(1100);
  await human.hover(page.locator('#cluster-map .scatterlayer .trace').nth(1).locator('.point').nth(2));
  await human.pause(800);
  await human.clickHere(); // its card, below, lit up
  await human.pause(1800);
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
    /** Glides to the middle of an element, as to read what it shows on hover. */
    async hover(locator: Locator) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Not on the page');
      await moveTo(box.x + box.width / 2, box.y + box.height / 2);
    },
    /** Clicks where the mouse is. */
    async clickHere() {
      await pause(150);
      await page.mouse.down();
      await pause(70);
      await page.mouse.up();
    },
    /** Scrolls by `dy` pixels with the wheel, in a few long flicks: each scrolled frame weighs on the GIF. */
    async scroll(dy: number) {
      const flicks = 3;
      for (let flick = 0; flick < flicks; flick++) {
        await page.mouse.wheel(0, dy / flicks);
        await pause(350);
      }
    },
    /** Empties the focused field, as a person does: everything selected, then deleted. */
    async clear() {
      await page.keyboard.press('ControlOrMeta+A');
      await pause(120);
      await page.keyboard.press('Backspace');
      await pause(250);
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

/** Records DEMO into `output`, an MP4 of at most MAX_SECONDS, and its GIF preview into `previewPath(output)`; the
 * seconds it lasts. */
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
    // The same video as an animated GIF, looping: a pull request's description shows it in place.
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', output, '-vf',
      `fps=${PREVIEW.fps},scale=${PREVIEW.width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];` +
        '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
      '-loop', '0', previewPath(output),
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
  console.log(`${output}, ${previewPath(output)}: ${seconds.toFixed(1)} s`);
}
