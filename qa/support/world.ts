// The page under test: the web view over the mock data (spec/demo.md), in Chromium through Playwright,
// 1280×720, light, the same in every run. CHROMIUM_PATH runs another Chromium than Playwright's own.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, setWorldConstructor, World } from '@cucumber/cucumber';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createWebServer } from '../../src/web.ts';
import { mockGitHub } from '../../mock/github.ts';

export const VIEWPORT = { width: 1280, height: 720 };

let server: Server;
let browser: Browser;
let base = '';

export class PageWorld extends World {
  context!: BrowserContext;
  page!: Page;
  base = '';
}
setWorldConstructor(PageWorld);
setDefaultTimeout(30_000);

BeforeAll(async () => {
  // No delay: the placeholders are not what the screenshots show.
  server = createWebServer({ fetch: mockGitHub(0) });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});

AfterAll(async () => {
  await browser?.close();
  server?.close();
});

Before(async function (this: PageWorld) {
  this.base = base;
  this.context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US' });
  this.page = await this.context.newPage();
});

After(async function (this: PageWorld) {
  await this.context?.close();
});
