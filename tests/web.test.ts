// The decisions in spec/web.md: the API on a running server, and the page in jsdom, its own script running,
// with GitHub answering from the recording in tests/helpers.ts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { replay } from '../src/core/replay.ts';
import { createWebServer, toGitHubUrl } from '../src/web.ts';
import { EXAMPLE_COMMIT, github } from './helpers.ts';

const LINK = `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`;

// JetBrains/copies: one skill in two agents' folders with the same bytes, and one whose copy differs.
const COPIES_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const skillText = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
const COPIES_FILES: Record<string, string> = {
  '.agents/skills/commits/SKILL.md': skillText('commits', 'Write commit messages.'),
  '.claude/skills/commits/SKILL.md': skillText('commits', 'Write commit messages.'),
  '.github/skills/commits/SKILL.md': skillText('commits', 'Write commit messages.'),
  '.agents/skills/review/SKILL.md': skillText('review', 'Review a change.'),
  '.claude/skills/review/SKILL.md': skillText('review', 'Review a change, the Claude way.'),
};
const COPIES = replay(
  {
    'https://api.github.com/repos/JetBrains/copies': { status: 200, body: { full_name: 'JetBrains/copies', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/copies/commits/main': { status: 200, body: { sha: COPIES_COMMIT } },
    'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/copies&per_page=100&page=1': {
      status: 200,
      // Code search can answer the same path twice.
      body: { total_count: 6, items: [...Object.keys(COPIES_FILES), '.claude/skills/commits/SKILL.md'].map((path) => ({ path })) },
    },
    ...Object.fromEntries(
      Object.entries(COPIES_FILES).map(([path, text]) => [
        `https://raw.githubusercontent.com/JetBrains/copies/${COPIES_COMMIT}/${path}`,
        { status: 200, body: text },
      ]),
    ),
  },
  github,
);
const copiesLink = (path: string) => `https://github.com/JetBrains/copies/blob/${COPIES_COMMIT}/${path}`;

const server = createWebServer({ fetch: COPIES, token: 'test' });
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
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

/** The page as the server serves it, its own script running, its fetch going to the server. */
async function openPage() {
  const dom = new JSDOM(await (await fetch(base)).text(), {
    url: base,
    runScripts: 'dangerously',
    beforeParse: (window) => {
      window.fetch = (input: string | URL | Request, init?: RequestInit) => fetch(new URL(String(input), base), init);
    },
  });
  const document = dom.window.document;
  const scan = async (repo: string) => {
    (document.getElementById('repo') as HTMLInputElement).value = repo;
    (document.getElementById('scan') as HTMLButtonElement).click();
    // The button is disabled while the scan runs.
    await waitFor(() => !(document.getElementById('scan') as HTMLButtonElement).disabled);
  };
  return { document, scan, close: () => dom.window.close() };
}

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(condition(), 'timed out');
}

test('in the page: type a repository, press Scan, the results appear below', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    // The search field and the button on top, the results in the bottom part.
    const form = document.getElementById('scan-form')!;
    const results = document.getElementById('results')!;
    assert.ok(form.compareDocumentPosition(results) & document.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(document.getElementById('scan')!.textContent, 'Scan');

    await page.scan('JetBrains/example');
    assert.equal(document.getElementById('status')!.textContent, 'JetBrains/example · 1 skill');
    const items = document.querySelectorAll('#skills li');
    assert.equal(items.length, 1);
    const name = items[0].querySelector('a.name') as HTMLAnchorElement;
    assert.equal(name.textContent, 'commits');
    assert.equal(name.href, LINK);
    assert.equal(items[0].querySelector('.summary')!.textContent, 'Write commit messages the way this repository does.');
    assert.equal(items[0].querySelector('.meta')!.textContent, '.claude/skills/commits/SKILL.md');
  } finally {
    page.close();
  }
});

test('in the page: an error replaces the results', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('JetBrains/example');
    assert.equal(document.querySelectorAll('#skills li').length, 1);
    await page.scan('JetBrains/not-answered');
    const status = document.getElementById('status')!;
    assert.equal(status.className, 'error');
    assert.match(status.textContent ?? '', /^Cannot reach GitHub: /);
    assert.equal(document.querySelectorAll('#skills li').length, 0);
  } finally {
    page.close();
  }
});

test('the API lists a skill once, its copies with the same bytes as `copies`; different bytes are two skills', async () => {
  const { status, body } = await api('JetBrains/copies');
  assert.equal(status, 200);
  assert.deepEqual(
    body.skills.map((skill: { name: string; link: string; copies: string[] }) => [skill.name, skill.link, skill.copies]),
    [
      ['commits', copiesLink('.agents/skills/commits/SKILL.md'), ['.claude/skills/commits/SKILL.md', '.github/skills/commits/SKILL.md']],
      ['review', copiesLink('.agents/skills/review/SKILL.md'), []],
      ['review', copiesLink('.claude/skills/review/SKILL.md'), []],
    ],
  );
  const ids = body.skills.map((skill: { id: string }) => skill.id);
  assert.equal(new Set(ids).size, ids.length, 'every skill id is unique');
});

test('in the page: each skill once, its copies as `also in`', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('JetBrains/copies');
    assert.equal(document.getElementById('status')!.textContent, 'JetBrains/copies · 3 skills');
    const items = [...document.querySelectorAll('#skills li')].map((item) =>
      [...item.querySelectorAll('.name, .summary, .meta')].map((node) => node.textContent),
    );
    assert.deepEqual(items, [
      ['commits', 'Write commit messages.', '.agents/skills/commits/SKILL.md', 'also in .claude/skills/commits/SKILL.md, .github/skills/commits/SKILL.md'],
      ['review', 'Review a change.', '.agents/skills/review/SKILL.md'],
      ['review', 'Review a change, the Claude way.', '.claude/skills/review/SKILL.md'],
    ]);
  } finally {
    page.close();
  }
});

test('in the page: scanning again replaces the results, it does not add to them', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('JetBrains/copies');
    await page.scan('JetBrains/copies');
    assert.equal(document.querySelectorAll('#skills li').length, 3);
    await page.scan('JetBrains/example');
    assert.equal(document.querySelectorAll('#skills li').length, 1);
  } finally {
    page.close();
  }
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
