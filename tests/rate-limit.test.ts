// spec/analysis.md, "Rate limit": a short one is waited out, a long one stops the scan with how long to wait.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openGitHub, openGitHubOrganization, type Fetch } from '../src/core/github.ts';
import { replay, type Recorded, type Recording } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { scanOrganization } from '../src/core/organization.ts';
import { EXAMPLE_COMMIT, github } from './helpers.ts';

const NOW = 1_800_000_000_000; // ms, on a whole second
const REPOSITORY = 'https://api.github.com/repos/JetBrains/example';
const SEARCH = 'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1';
const SKILL = `https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`;

/** GitHub's answer for `url` is `limited` the first `times` times, then the recorded one in tests/helpers.ts. */
function limitedFor(url: string, times: number, limited: Recorded): { fetch: Fetch; asked: () => number } {
  let asked = 0;
  const once = replay({ [url]: limited } satisfies Recording);
  return {
    fetch: async (requested, init) => {
      if (requested !== url) return github(requested, init);
      asked++;
      return asked <= times ? once(requested, init) : github(requested, init);
    },
    asked: () => asked,
  };
}

/** Waits nothing; remembers how long it was asked to wait. */
function clock() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms), now: () => NOW };
}

const searchLimit = (resetIn: number): Recorded => ({
  status: 403,
  headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + resetIn) },
  body: { message: 'API rate limit exceeded for user ID 1.' },
});

test('code search limit that resets in 20 s → waited out, the scan goes on, a notice said so', async () => {
  const { fetch, asked } = limitedFor(SEARCH, 1, searchLimit(20));
  const { waits, sleep, now } = clock();
  const notices: string[] = [];
  const result = await scan(await openGitHub('https://github.com/JetBrains/example', { fetch, token: 'test', sleep, now, notice: (text) => notices.push(text) }));
  assert.deepEqual(result.skills.map((skill) => skill.name), ['commits']);
  assert.deepEqual(waits, [21_000]); // a second more than the reset, to be sure
  assert.equal(asked(), 2);
  assert.deepEqual(notices, ['GitHub rate limit reached; waiting 21 s']);
});

test('`retry-after` → waited out exactly as long', async () => {
  const { fetch } = limitedFor(REPOSITORY, 1, { status: 429, headers: { 'retry-after': '7' }, body: { message: 'Too many requests' } });
  const { waits, sleep, now } = clock();
  const result = await scan(await openGitHub('https://github.com/JetBrains/example', { fetch, token: 'test', sleep, now }));
  assert.equal(result.skills.length, 1);
  assert.deepEqual(waits, [7_000]);
});

test('a secondary limit with no headers → a minute waited out, as GitHub advises', async () => {
  const { fetch } = limitedFor(REPOSITORY, 1, { status: 403, body: { message: 'You have exceeded a secondary rate limit.' } });
  const { waits, sleep, now } = clock();
  const result = await scan(await openGitHub('https://github.com/JetBrains/example', { fetch, token: 'test', sleep, now }));
  assert.equal(result.skills.length, 1);
  assert.deepEqual(waits, [60_000]);
});

test("a file's bytes, 429 → waited out too", async () => {
  const { fetch } = limitedFor(SKILL, 1, { status: 429, headers: { 'retry-after': '2' }, body: 'Too many requests' });
  const { waits, sleep, now } = clock();
  const result = await scan(await openGitHub('https://github.com/JetBrains/example', { fetch, token: 'test', sleep, now }));
  assert.deepEqual(result.skills.map((skill) => skill.name), ['commits']);
  assert.deepEqual(waits, [2_000]);
});

test('still limited after 3 tries again → the scan stops: try again in a minute', async () => {
  const { fetch, asked } = limitedFor(SEARCH, Infinity, searchLimit(30));
  const { waits, sleep, now } = clock();
  await assert.rejects(openGitHub('https://github.com/JetBrains/example', { fetch, token: 'test', sleep, now }), {
    message: 'GitHub rate limit reached; try again in a minute',
  });
  assert.equal(asked(), 4);
  assert.deepEqual(waits, [31_000, 31_000, 31_000]);
});

test('a limit that resets in more than a minute → no wait, the scan stops: how long to wait', async () => {
  const { fetch } = limitedFor(SEARCH, Infinity, searchLimit(10 * 60 + 30));
  const { waits, sleep, now } = clock();
  await assert.rejects(openGitHub('https://github.com/JetBrains/example', { fetch, token: 'test', sleep, now }), {
    message: 'GitHub rate limit reached; try again in 11 minutes',
  });
  assert.deepEqual(waits, []);
});

test('a 403 that is not a rate limit → not waited, not called one', async () => {
  const { fetch } = limitedFor(REPOSITORY, Infinity, { status: 403, body: { message: 'Resource not accessible by integration' } });
  const { waits, sleep, now } = clock();
  await assert.rejects(openGitHub('https://github.com/JetBrains/example', { fetch, token: 'test', sleep, now }), {
    message: `GitHub answered 403 for ${REPOSITORY}: Resource not accessible by integration`,
  });
  assert.deepEqual(waits, []);
});

test('an organization: a short limit in the middle is waited out, every repository is scanned', async () => {
  const { fetch } = limitedFor('https://api.github.com/repos/Acme/app/commits/main', 1, searchLimit(15));
  const { waits, sleep, now } = clock();
  const organization = await openGitHubOrganization('https://github.com/Acme', { fetch, token: 'test', sleep, now });
  const scanned: string[] = [];
  for await (const { repository, error } of scanOrganization(organization)) scanned.push(error ? `${repository.id}: ${error}` : repository.id);
  assert.deepEqual(scanned, ['Acme/app', 'Acme/big', 'Acme/broken: GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error', 'Acme/docs', 'Acme/empty']);
  assert.deepEqual(waits, [16_000]);
});
