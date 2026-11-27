// The QA scenarios of spec/qa.md, run as one test: `npm run qa`, the Cucumber features in qa/features, each page
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

test('qa: every scenario in qa/features passes, its page the same as its screenshot', { skip: reason, timeout: 120_000 }, () => {
  const run = spawnSync('npx', ['cucumber-js', '--config', 'qa/cucumber.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, QA_UPDATE_SCREENSHOTS: '' },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /8 scenarios \(8 passed\)/);
});

test('qa: each screenshot a scenario compares with is in qa/screenshots', () => {
  const features = readdirSync(`${root}qa/features`).map((name) => `${root}qa/features/${name}`);
  const named = features.flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/the screenshot "([^"]+)"/g)].map((match) => match[1]));
  assert.equal(named.length, 8);
  assert.deepEqual(named.map((name) => `${name}.png`).sort(), readdirSync(`${root}qa/screenshots`).sort());
});
