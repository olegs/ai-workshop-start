// spec/web.md, "Cache": the web server keeps what it scanned for 24 hours, with GitHub answering from the
// recording in tests/helpers.ts and every request it gets counted.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { createCache, DAY } from '../src/core/cache.ts';
import type { Fetch } from '../src/core/github.ts';
import { createWebServer } from '../src/web.ts';
import { github } from './helpers.ts';

/** A server on its own cache and clock, and the GitHub requests it made. */
async function serve(t: TestContext, fetch: Fetch = github, cacheLimit?: number) {
  const requests: string[] = [];
  const clock = { time: Date.parse('2026-11-26T12:00:00Z') };
  const server = createWebServer({
    fetch: (url, init) => {
      requests.push(url);
      return fetch(url, init);
    },
    token: 'test',
    now: () => clock.time,
    cacheLimit,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  /** The answer's text, and the GitHub requests made for it. */
  const scan = async (repo: string) => {
    const before = requests.length;
    const response = await globalThis.fetch(`${base}/api/scan?repo=${encodeURIComponent(repo)}`);
    const text = await response.text();
    return { status: response.status, text, requests: requests.slice(before) };
  };
  return { scan, clock, requests };
}

test('a repository scanned again within 24 hours: the same answer, nothing fetched from GitHub', async (t) => {
  const { scan, clock } = await serve(t);
  const first = await scan('JetBrains/example');
  assert.equal(first.status, 200);
  assert.ok(first.requests.length > 0);
  // Any way of naming it, case aside.
  for (const repo of ['JetBrains/example', 'https://github.com/JetBrains/example', 'jetbrains/EXAMPLE']) {
    clock.time += DAY / 4;
    const again = await scan(repo);
    assert.equal(again.status, 200);
    assert.equal(again.text, first.text);
    assert.deepEqual(again.requests, []);
  }
});

test('after 24 hours, GitHub is asked again', async (t) => {
  const { scan, clock } = await serve(t);
  const first = await scan('JetBrains/example');
  clock.time += DAY - 1;
  assert.deepEqual((await scan('JetBrains/example')).requests, []);
  clock.time += 1;
  const later = await scan('JetBrains/example');
  assert.equal(later.text, first.text);
  assert.deepEqual(later.requests, first.requests);
});

test('an organization scanned again within 24 hours: the same lines, nothing fetched; its repositories alone too', async (t) => {
  const { scan, clock } = await serve(t);
  const first = await scan('Acme');
  assert.equal(first.status, 200);
  clock.time += DAY / 2;
  const again = await scan('https://github.com/acme');
  assert.equal(again.text, first.text);
  // Only Acme/broken, which could not be scanned, is asked for again.
  assert.deepEqual(again.requests, ['https://api.github.com/repos/Acme/broken/commits/main']);
  // A repository it scanned, asked for alone, is the line the organization streamed for it.
  const app = await scan('Acme/app');
  assert.equal(app.status, 200);
  assert.deepEqual(app.requests, []);
  assert.deepEqual(JSON.parse(app.text), JSON.parse(first.text.split('\n')[1]));
  clock.time += DAY;
  assert.deepEqual((await scan('Acme')).requests, first.requests);
});

test('what could not be scanned is not kept: an unreachable repository, a rate limit, are asked for again', async (t) => {
  let down = true;
  const flaky: Fetch = async (url, init) => {
    if (down && url === 'https://api.github.com/repos/JetBrains/example') return new Response('{"message":"Server Error"}', { status: 500 });
    return github(url, init);
  };
  const { scan } = await serve(t, flaky);
  assert.equal((await scan('JetBrains/example')).status, 502);
  down = false;
  const recovered = await scan('JetBrains/example');
  assert.equal(recovered.status, 200);
  assert.ok(recovered.requests.length > 0);

  const limited = await scan('Limited');
  assert.match(limited.text, /rate limit/);
  const again = await scan('Limited');
  assert.equal(again.text, limited.text);
  // Limited/a was scanned and kept; Limited/b hit the rate limit and is asked for again.
  assert.deepEqual(again.requests, ['https://api.github.com/repos/Limited/b/commits/main']);
  assert.equal((await scan('nobody')).status, 502);
  assert.deepEqual((await scan('nobody')).requests, ['https://api.github.com/users/nobody']);
});

test('the same repository asked for twice at once: fetched from GitHub once', async (t) => {
  const { scan, requests } = await serve(t);
  const [a, b] = await Promise.all([scan('JetBrains/example'), scan('JetBrains/example')]);
  assert.equal(a.status, 200);
  assert.equal(a.text, b.text);
  // Each request once: the second scan waited for the first one's answer.
  assert.equal(requests.length, 4);
  assert.equal(new Set(requests).size, requests.length);
});

/** Huge, an organization of 1200 repositories with no skills, more than one fetch per repository. */
const HUGE = 1200;
const huge: Fetch = async (url, init) => {
  const api = 'https://api.github.com';
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url === `${api}/users/Huge`) return answer({ login: 'Huge', type: 'Organization' });
  const page = /^https:\/\/api\.github\.com\/orgs\/Huge\/repos\?per_page=100&page=(\d+)$/.exec(url);
  if (page) {
    const start = (Number(page[1]) - 1) * 100;
    const ids = Array.from({ length: Math.max(0, Math.min(100, HUGE - start)) }, (_, i) => `Huge/r${String(start + i).padStart(4, '0')}`);
    return answer(ids.map((id) => ({ full_name: id, default_branch: 'main' })));
  }
  if (/\/repos\/Huge\/r\d+\/commits\/main$/.test(url)) return answer({ sha: 'a'.repeat(40) });
  if (/\/repos\/Huge\/r\d+\/git\/trees\//.test(url)) return answer({ truncated: false, tree: [] });
  return github(url, init);
};

test('an organization of more than a thousand repositories, scanned again: nothing fetched', async (t) => {
  const { scan } = await serve(t, huge);
  const first = await scan('Huge');
  assert.equal(first.text.trimEnd().split('\n').length, 1 + HUGE);
  assert.ok(first.requests.length > 2 * HUGE);
  const again = await scan('Huge');
  assert.equal(again.text, first.text);
  assert.deepEqual(again.requests, []);
});

test('a server keeps at most its cache limit, the oldest go first', async (t) => {
  // Acme: its list and four repositories scanned; Acme/broken is not kept.
  const fits = await serve(t, github, 5);
  await fits.scan('Acme');
  assert.deepEqual((await fits.scan('Acme')).requests, ['https://api.github.com/repos/Acme/broken/commits/main']);
  const small = await serve(t, github, 4);
  const first = await small.scan('Acme');
  // Past the limit, the list went first: all is fetched again.
  assert.deepEqual((await small.scan('Acme')).requests, first.requests);
});

test('the cache keeps at most its limit, the oldest goes first', async () => {
  const cache = createCache({ limit: 2, now: () => 0 });
  let loads = 0;
  const load = (value: string) => async () => (loads++, value);
  await cache.get('a', load('a'));
  await cache.get('b', load('b'));
  await cache.get('c', load('c'));
  assert.equal(cache.size, 2);
  assert.equal(loads, 3);
  assert.equal(await cache.get('c', load('c')), 'c');
  assert.equal(await cache.get('b', load('b')), 'b');
  assert.equal(loads, 3);
  assert.equal(await cache.get('a', load('a')), 'a');
  assert.equal(loads, 4);
});
