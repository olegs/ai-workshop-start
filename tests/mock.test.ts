// The decisions in spec/demo.md: the mock data the demos show, and the demo video itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createWebServer } from '../src/web.ts';
import { MOCK_ORGANIZATION, MOCK_REPOSITORIES, mockGitHub } from '../mock/github.ts';

const server = createWebServer({ fetch: mockGitHub() });
let base = '';

before(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const scan = async (repo: string) => fetch(`${base}/api/scan?repo=${encodeURIComponent(repo)}`);

test('mock: each example repository on the page scans to its mocked skills, with no warnings', async () => {
  const page = await (await fetch(base)).text();
  for (const { id, commit, skills } of MOCK_REPOSITORIES) {
    assert.match(page, new RegExp(`data-repo="${id}"`), `${id} is one of the page's examples`);
    const response = await scan(id);
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.repository.commit, commit);
    assert.deepEqual(answer.warnings, []);
    assert.deepEqual(answer.skills.map((skill: { name: string }) => skill.name).sort(), skills.map((skill) => skill.name).sort());
    for (const skill of answer.skills) assert.ok(skill.summary, `${skill.name} has a summary`);
  }
});

test('mock: a skill in two agents\' folders shows once, the other path as also in', async () => {
  const answer = await (await scan('JetBrains/kotlin')).json();
  const copied = answer.skills.filter((skill: { copies: string[] }) => skill.copies.length > 0);
  assert.deepEqual(
    copied.map((skill: { name: string; path: string; copies: string[] }) => [skill.name, [skill.path, ...skill.copies].sort()]),
    [['compiler-test-data', ['.agents/skills/compiler-test-data/SKILL.md', '.claude/skills/compiler-test-data/SKILL.md']]],
  );
});

test('mock: the organization lists every mocked repository, each scanned', async () => {
  const response = await scan(MOCK_ORGANIZATION);
  assert.equal(response.status, 200);
  const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines[0].repositories.map((repository: { id: string }) => repository.id).sort(), MOCK_REPOSITORIES.map(({ id }) => id).sort());
  assert.deepEqual(lines.slice(1).map((line) => [line.repository.id, line.skills.length]).sort(), MOCK_REPOSITORIES.map(({ id, skills }) => [id, skills.length]).sort());
});

test('mock: the same answers every time', async () => {
  assert.deepEqual(await (await scan('JetBrains/koog')).json(), await (await createAnswer('JetBrains/koog')));
});

/** A fresh server over the mock data: nothing cached. */
async function createAnswer(repo: string) {
  const fresh = createWebServer({ fetch: mockGitHub() });
  await new Promise<void>((done) => fresh.listen(0, '127.0.0.1', done));
  try {
    return await (await fetch(`http://127.0.0.1:${(fresh.address() as AddressInfo).port}/api/scan?repo=${repo}`)).json();
  } finally {
    fresh.close();
  }
}

test('mock: anything else is not mocked, nothing reaches the network', async () => {
  const response = await scan('JetBrains/elsewhere');
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/elsewhere/);
});

// The video needs Chromium for Playwright and ffmpeg: where they are not installed, as in CI, it is skipped.
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const { chromium } = await import('playwright');
const reason = !ffmpeg ? 'no ffmpeg' : !existsSync(chromium.executablePath()) ? 'no Chromium for Playwright' : false;

test('demo: an MP4 of at most 10 seconds, H.264, from the page over the mock data, and its GIF preview', { skip: reason, timeout: 120_000 }, async () => {
  const { recordDemo, previewPath, MAX_SECONDS, PREVIEW } = await import('../mock/demo.ts');
  const directory = mkdtempSync(join(tmpdir(), 'skill-atlas-demo-test-'));
  try {
    const output = join(directory, 'demo.mp4');
    const seconds = await recordDemo(output);
    assert.ok(seconds > 0 && seconds <= MAX_SECONDS);
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', output], { encoding: 'utf8' });
    const { streams, format } = JSON.parse(probe);
    assert.equal(streams[0].codec_name, 'h264');
    assert.deepEqual([streams[0].width, streams[0].height], [1280, 720]);
    assert.ok(Number(format.duration) <= MAX_SECONDS + 0.05, `lasts ${format.duration} s`);

    // The preview, next to the video: an animated GIF of the same seconds, small enough for a pull request.
    const preview = join(directory, 'demo.gif');
    assert.equal(previewPath(output), preview);
    assert.ok(statSync(preview).size < 2 * 1024 * 1024, `the preview is ${statSync(preview).size} bytes`);
    const gif = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', preview], { encoding: 'utf8' }));
    assert.equal(gif.streams[0].codec_name, 'gif');
    assert.deepEqual([gif.streams[0].width, gif.streams[0].height], [PREVIEW.width, PREVIEW.width * 720 / 1280]);
    assert.ok(Number(gif.streams[0].nb_read_frames) > 1, 'the preview moves');
    assert.ok(Math.abs(Number(gif.format.duration) - Number(format.duration)) < 0.5, `the preview lasts ${gif.format.duration} s, the video ${format.duration} s`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
