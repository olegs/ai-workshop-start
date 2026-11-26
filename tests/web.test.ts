// The decisions in spec/web.md: the API on a running server, and the page in a real browser,
// with GitHub answering from the recording in tests/helpers.ts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { replay } from '../src/core/replay.ts';
import { createWebServer, toGitHubUrl } from '../src/web.ts';
import { EXAMPLE_COMMIT, github } from './helpers.ts';

const LINK = `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`;

const server = createWebServer({ fetch: github, token: 'test' });
let base = '';
let browser: Browser;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server.close();
});

const api = async (repo: string) => {
  const response = await fetch(`${base}/api/scan?repo=${encodeURIComponent(repo)}`);
  return { status: response.status, body: await response.json() };
};

test('owner/repo is shorthand for the GitHub URL', () => {
  assert.equal(toGitHubUrl(' JetBrains/kotlin '), 'https://github.com/JetBrains/kotlin');
  assert.equal(toGitHubUrl('https://github.com/JetBrains/kotlin'), 'https://github.com/JetBrains/kotlin');
});

test('the page has a repository field and a Scan button', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  const html = await response.text();
  assert.match(html, /<input id="repo"/);
  assert.match(html, /<button id="scan" type="submit">Scan<\/button>/);
});

test('the API scans a repository: each skill with its first sentence and pinned link', async () => {
  for (const repo of ['JetBrains/example', 'https://github.com/JetBrains/example']) {
    const { status, body } = await api(repo);
    assert.equal(status, 200);
    assert.deepEqual(body, {
      repository: { id: 'JetBrains/example', url: 'https://github.com/JetBrains/example', commit: EXAMPLE_COMMIT },
      skills: [
        {
          id: 'JetBrains/example:.claude/skills/commits/SKILL.md',
          name: 'commits',
          description: 'Write commit messages the way this repository does. Use for every commit.',
          summary: 'Write commit messages the way this repository does.',
          path: '.claude/skills/commits/SKILL.md',
          link: LINK,
          copies: [],
        },
      ],
      warnings: [],
    });
  }
});

test('the API rejects an empty input and anything but a GitHub repository, local directories included', async () => {
  assert.deepEqual(await api(''), { status: 400, body: { error: 'Enter a GitHub repository, such as JetBrains/kotlin' } });
  assert.deepEqual(await api('/etc'), { status: 400, body: { error: 'Not a GitHub repository: /etc' } });
  assert.deepEqual(await api('./fixture'), { status: 400, body: { error: 'Not a GitHub repository: ./fixture' } });
});

test('unreachable repository → the clear message, status 502', async () => {
  assert.deepEqual(await api('JetBrains/not-answered'), {
    status: 502,
    body: { error: 'Cannot reach GitHub: not recorded: https://api.github.com/repos/JetBrains/not-answered' },
  });
  const missing = createWebServer({
    fetch: replay({ 'https://api.github.com/repos/JetBrains/nope': { status: 404, body: { message: 'Not Found' } } }),
  });
  await new Promise<void>((resolve) => missing.listen(0, '127.0.0.1', resolve));
  try {
    const port = (missing.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/scan?repo=JetBrains/nope`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Repository not found: https://github.com/JetBrains/nope' });
  } finally {
    missing.close();
  }
});

test('unknown paths are 404', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test('in the browser: type a repository, press Scan, the results appear below', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  await page.fill('#repo', 'JetBrains/example');
  await page.click('#scan');
  await page.locator('#skills li').first().waitFor();
  assert.equal(await page.textContent('#status'), 'JetBrains/example · 1 skill');
  assert.equal(await page.textContent('#skills .name'), 'commits');
  assert.equal(await page.getAttribute('#skills .name', 'href'), LINK);
  assert.equal(await page.textContent('#skills .summary'), 'Write commit messages the way this repository does.');
  // The results are in the bottom part, under the search field.
  const form = await page.locator('#scan-form').boundingBox();
  const results = await page.locator('#results').boundingBox();
  assert.ok(form && results && results.y >= form.y + form.height);
  await page.close();
});

test('in the browser: an error is shown in place of the results', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  await page.fill('#repo', 'JetBrains/not-answered');
  await page.click('#scan');
  await page.locator('#status.error').waitFor();
  assert.match((await page.textContent('#status')) ?? '', /^Cannot reach GitHub: /);
  assert.equal(await page.locator('#skills li').count(), 0);
  await page.close();
});

test('the server listens on port 3000 by default', async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.ts', import.meta.url))], {
    env: { ...process.env, PORT: '' },
  });
  t.after(() => child.kill());
  const line = await new Promise<string>((resolve, reject) => {
    child.stdout.once('data', (data) => resolve(String(data)));
    child.once('exit', (code) => reject(new Error(`exited with ${code}`)));
  });
  assert.equal(line.trim(), 'Skill Atlas on http://localhost:3000');
  assert.equal((await fetch('http://localhost:3000/')).status, 200);
});
