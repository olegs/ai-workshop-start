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
// JetBrains/empty: code search lists a SKILL.md that is not there at the scanned commit.
const EMPTY_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const EMPTY = {
  'https://api.github.com/repos/JetBrains/empty': { status: 200, body: { full_name: 'JetBrains/empty', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/empty/commits/main': { status: 200, body: { sha: EMPTY_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/empty&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/gone/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/empty/${EMPTY_COMMIT}/.claude/skills/gone/SKILL.md`]: { status: 404, body: '404: Not Found' },
};
const copiesLink = (path: string) => `https://github.com/JetBrains/copies/blob/${COPIES_COMMIT}/${path}`;

const server = createWebServer({ fetch: replay(EMPTY, COPIES), token: 'test' });
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
  const { document } = new JSDOM(await response.text()).window;
  const form = document.getElementById('scan-form')!;
  const input = form.querySelector('input#repo') as HTMLInputElement;
  assert.equal(input.type, 'search');
  assert.equal(input.getAttribute('aria-label'), 'GitHub repository');
  const button = form.querySelector('button#scan') as HTMLButtonElement;
  assert.equal(button.type, 'submit');
  assert.equal(button.textContent, 'Scan');
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
async function openPage(path = '/') {
  const dom = new JSDOM(await (await fetch(base)).text(), {
    url: new URL(path, base).href,
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
  return { document, window: dom.window, scan, close: () => dom.window.close() };
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

    const loading = document.getElementById('loading')!;
    const visible = (node: Element) => page.window.getComputedStyle(node).display !== 'none';
    assert.equal(visible(loading), false);
    const scanning = page.scan('JetBrains/example');
    assert.equal(visible(loading), true, 'placeholders while the scan runs');
    await scanning;
    assert.equal(document.getElementById('status')!.textContent, 'JetBrains/example · 1 skill');
    // The placeholders are gone once the results are in: hidden, whatever the page's CSS says.
    assert.equal(visible(loading), false);
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

test('in the page: the repository and the scanned commit are linked above the results', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('JetBrains/example');
    assert.equal((document.querySelector('#status a') as HTMLAnchorElement).href, 'https://github.com/JetBrains/example');
    const commit = document.querySelector('#commit a') as HTMLAnchorElement;
    assert.equal(commit.textContent, `@ ${EXAMPLE_COMMIT.slice(0, 7)}`);
    assert.equal(commit.href, `https://github.com/JetBrains/example/tree/${EXAMPLE_COMMIT}`);
    // Links to GitHub open in a new tab.
    for (const link of document.querySelectorAll<HTMLAnchorElement>('#results a')) assert.equal(link.target, '_blank');
  } finally {
    page.close();
  }
});

test('in the page: no skills → `0 skills` and an empty state; warnings in their own box', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    assert.equal((document.getElementById('warnings-box') as HTMLDetailsElement).hidden, true);
    await page.scan('JetBrains/empty');
    assert.equal(document.getElementById('status')!.textContent, 'JetBrains/empty · 0 skills');
    assert.equal(document.querySelectorAll('#skills .skill').length, 0);
    assert.equal(document.querySelector('#skills .empty')!.textContent, 'No skills in this repository.');
    assert.equal((document.getElementById('warnings-box') as HTMLDetailsElement).hidden, false);
    assert.equal(document.getElementById('warnings-title')!.textContent, '1 warning');
    assert.deepEqual(
      [...document.querySelectorAll('#warnings li')].map((item) => item.textContent),
      ['warning: .claude/skills/gone/SKILL.md: listed, but not found at the scanned commit; skipped'],
    );
    // The next scan clears them.
    await page.scan('JetBrains/example');
    assert.equal((document.getElementById('warnings-box') as HTMLDetailsElement).hidden, true);
    assert.equal(document.querySelectorAll('#skills .empty').length, 0);
  } finally {
    page.close();
  }
});

test('in the page: a link with ?repo= scans at once, and a scan puts the repository in the address', async () => {
  const page = await openPage('/?repo=JetBrains%2Fexample');
  try {
    const { document, window } = page;
    await waitFor(() => document.querySelectorAll('#skills .skill').length === 1);
    assert.equal((document.getElementById('repo') as HTMLInputElement).value, 'JetBrains/example');
    assert.equal(document.getElementById('status')!.textContent, 'JetBrains/example · 1 skill');
    await page.scan('JetBrains/copies');
    assert.equal(window.location.search, '?repo=JetBrains%2Fcopies');
  } finally {
    page.close();
  }
});

test('in the page: an example repository is scanned on a click', async () => {
  const page = await openPage();
  try {
    const { document, window } = page;
    const examples = [...document.querySelectorAll<HTMLButtonElement>('.examples button')];
    assert.deepEqual(examples.map((example) => example.textContent), ['JetBrains/kotlin', 'JetBrains/MPS', 'JetBrains/koog']);
    examples[0].click();
    assert.equal((document.getElementById('scan') as HTMLButtonElement).disabled, true, 'the scan has started');
    await waitFor(() => !(document.getElementById('scan') as HTMLButtonElement).disabled);
    assert.equal((document.getElementById('repo') as HTMLInputElement).value, 'JetBrains/kotlin');
    assert.equal(window.location.search, '?repo=JetBrains%2Fkotlin');
    // Not recorded: the scan reached the server and came back as an error.
    assert.match(document.getElementById('status')!.textContent ?? '', /^Cannot reach GitHub: not recorded: .*JetBrains\/kotlin$/);
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
