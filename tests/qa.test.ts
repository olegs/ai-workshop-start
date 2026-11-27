// The QA tests of spec/qa.md, run as one test: `npm run qa`, the Playwright tests in qa/web.spec.ts, each page
// compared with its screenshot in qa/screenshots. Needs Chromium: Playwright's own, or CHROMIUM_PATH; without it,
// as in CI, it is skipped.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = await import('playwright');
const executable = process.env.CHROMIUM_PATH || chromium.executablePath();
const reason = existsSync(executable) ? false : 'no Chromium for Playwright, and no CHROMIUM_PATH';

test('qa: every test in qa/web.spec.ts passes, its page the same as its screenshot', { skip: reason, timeout: 120_000 }, () => {
  const run = spawnSync('npx', ['playwright', 'test', '-c', 'qa', '--reporter=line'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /8 passed/);
});

test('qa: each screenshot a test compares with is in qa/screenshots, and no other', () => {
  const named = [...readFileSync(`${root}qa/web.spec.ts`, 'utf8').matchAll(/matchesScreenshot\(page, '([^']+)'\)/g)].map((match) => match[1]);
  assert.equal(named.length, 8);
  assert.deepEqual(named.map((name) => `${name}.png`).sort(), readdirSync(`${root}qa/screenshots`).sort());
});
