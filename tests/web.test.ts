// The decisions in spec/web.md: the API on a running server, and the page in jsdom, its own script running,
// with GitHub answering from the recording in tests/helpers.ts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, get, type IncomingHttpHeaders } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { replay } from '../src/core/replay.ts';
import { createWebServer, toGitHubUrl } from '../src/web.ts';
import type { Fetch } from '../src/core/github.ts';
import { commitIn, EXAMPLE_COMMIT, github } from './helpers.ts';
import { mockGitHub } from '../mock/github.ts';

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
  assert.equal(toGitHubUrl(' JetBrains '), 'https://github.com/JetBrains');
  assert.equal(toGitHubUrl('https://github.com/JetBrains'), 'https://github.com/JetBrains');
});

test('the page has a repository field and a Scan button', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  const { document } = new JSDOM(await response.text()).window;
  const form = document.getElementById('scan-form')!;
  const input = form.querySelector('input#repo') as HTMLInputElement;
  assert.equal(input.type, 'search');
  assert.equal(input.getAttribute('aria-label'), 'GitHub repository or organization');
  const button = form.querySelector('button#scan') as HTMLButtonElement;
  assert.equal(button.type, 'submit');
  assert.equal(button.textContent, 'Scan');
});

test('the page has no footer and does not claim that nothing is stored: the server caches', async () => {
  const html = await (await fetch(base)).text();
  const { document } = new JSDOM(html).window;
  assert.equal(document.querySelector('footer'), null);
  assert.doesNotMatch(document.body.textContent!, /nothing is stored|read live from github/i);
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
  assert.deepEqual(await api(''), { status: 400, body: { error: 'Enter a GitHub repository or organization, such as JetBrains/kotlin or JetBrains' } });
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
/** What the page asked Plotly to draw: each call's traces and layout, the latest last. */
type Drawn = { data: { name: string; text: string[]; x: number[]; y: number[]; customdata: [number, string, string][]; marker: { color: string } }[]; layout: Record<string, unknown> };

async function openPage(path = '/', server = base) {
  const plotted: Drawn[] = [];
  const dom = new JSDOM(await (await fetch(server)).text(), {
    url: new URL(path, server).href,
    runScripts: 'dangerously',
    // The page's own scripts from the server, /cluster.js too, as a browser loads them.
    resources: 'usable',
    beforeParse: (window) => {
      window.fetch = (input: string | URL | Request, init?: RequestInit) => fetch(new URL(String(input), server), init);
      // Plotly draws nothing in jsdom: what it is asked to draw is recorded instead. Real drawing: the QA tests.
      Object.assign(window, {
        Plotly: {
          react: async (_element: Element, data: Drawn['data'], layout: Drawn['layout']) => void plotted.push(structuredClone({ data, layout })),
          purge: () => {},
        },
      });
    },
  });
  const document = dom.window.document;
  if (document.readyState !== 'complete') await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  const scan = async (repo: string) => {
    (document.getElementById('repo') as HTMLInputElement).value = repo;
    (document.getElementById('scan') as HTMLButtonElement).click();
    // The button is disabled while the scan runs.
    await waitFor(() => !(document.getElementById('scan') as HTMLButtonElement).disabled);
  };
  return { document, window: dom.window, scan, plotted, close: () => dom.window.close() };
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

// spec/web.md, "Organization": the repositories of Acme and Limited in tests/helpers.ts, one by one.
const acmeLink = (id: string, path: string) => `https://github.com/${id}/blob/${commitIn(id)}/${path}`;

/** The lines of an organization's answer. */
async function lines(repo: string) {
  const response = await fetch(`${base}/api/scan?repo=${encodeURIComponent(repo)}`);
  const text = await response.text();
  assert.ok(text.endsWith('\n'));
  return { status: response.status, type: response.headers.get('content-type'), lines: text.trimEnd().split('\n').map((line) => JSON.parse(line)) };
}

test('the API streams an organization: the organization and its repositories, then one line for each as it is scanned', async () => {
  for (const repo of ['Acme', 'https://github.com/Acme']) {
    const answer = await lines(repo);
    assert.equal(answer.status, 200);
    assert.equal(answer.type, 'application/x-ndjson; charset=utf-8');
    const ids = ['Acme/app', 'Acme/big', 'Acme/broken', 'Acme/docs', 'Acme/empty'];
    assert.deepEqual(answer.lines[0], {
      organization: { id: 'Acme', url: 'https://github.com/Acme' },
      repositories: ids.map((id) => ({ id, url: `https://github.com/${id}` })),
    });
    assert.deepEqual(
      answer.lines.slice(1).map((line) => [line.repository.id, line.repository.commit, line.skills?.map((skill: { link: string }) => skill.link), line.error]),
      [
        ['Acme/app', commitIn('Acme/app'), [acmeLink('Acme/app', '.claude/skills/deploy/SKILL.md'), acmeLink('Acme/app', 'web/.agents/skills/lint/SKILL.md')], undefined],
        ['Acme/big', commitIn('Acme/big'), [acmeLink('Acme/big', 'modules/x/.claude/skills/release/SKILL.md')], undefined],
        ['Acme/broken', '', undefined, 'GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error'],
        ['Acme/docs', commitIn('Acme/docs'), [], undefined],
        ['Acme/empty', '', [], undefined],
      ],
    );
    // Each repository's line is what /api/scan answers for that repository alone.
    assert.deepEqual(Object.keys(answer.lines[1]), ['repository', 'skills', 'warnings']);
    assert.equal(answer.lines[1].skills[0].summary, 'Deploy the app.');
  }
});

test('the API: an unreachable organization → the clear message, status 502; a rate limit stops the stream with `{ error }`', async () => {
  assert.deepEqual(await api('nobody'), { status: 502, body: { error: 'Organization not found: https://github.com/nobody' } });
  const limited = await lines('Limited');
  assert.equal(limited.status, 200);
  assert.deepEqual(
    limited.lines.slice(1).map((line) => line.repository?.id ?? line),
    ['Limited/a', { error: 'GitHub rate limit reached; try again in 60 minutes' }],
  );
});

/** Each repository section of the page: its heading, then its skills' names or its error. */
const sections = (document: Document) =>
  [...document.querySelectorAll('#repositories .repository')].map((section) => [
    section.querySelector('h2')!.textContent,
    ...[...section.querySelectorAll('.skill .name, .problem')].map((node) => node.textContent),
  ]);

test('in the page: an organization → each repository with skills, the counts above, failures as warnings', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('Acme');
    assert.equal(document.getElementById('status')!.textContent, 'Acme · 5 repositories · 3 skills');
    assert.equal((document.querySelector('#status a') as HTMLAnchorElement).href, 'https://github.com/Acme');
    assert.deepEqual(sections(document), [
      ['Acme/app · 2 skills', 'deploy', 'lint'],
      ['Acme/big · 1 skill', 'release'],
      ['Acme/broken', 'GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error'],
      // Not shown, no skills: Acme/docs and Acme/empty.
    ]);
    const first = document.querySelector('#repositories .repository')!;
    assert.equal((first.querySelector('.skill .name') as HTMLAnchorElement).href, acmeLink('Acme/app', '.claude/skills/deploy/SKILL.md'));
    assert.equal(first.querySelector('.skill .summary')!.textContent, 'Deploy the app.');
    const commit = first.querySelector('.repository-head .commit') as HTMLAnchorElement;
    assert.equal(commit.textContent, `@ ${commitIn('Acme/app').slice(0, 7)}`);
    assert.equal(commit.href, `https://github.com/Acme/app/tree/${commitIn('Acme/app')}`);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('#results a')) assert.equal(link.target, '_blank');
    assert.deepEqual(
      [...document.querySelectorAll('#warnings li')].map((item) => item.textContent),
      ['warning: Acme/broken: GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error; skipped'],
    );
    assert.equal(page.window.location.search, '?repo=Acme');
    // Scanning a repository again replaces them.
    await page.scan('JetBrains/example');
    assert.equal(document.querySelectorAll('#repositories .repository').length, 0);
    assert.equal(document.querySelectorAll('#skills .skill').length, 1);
    assert.equal((document.getElementById('warnings-box') as HTMLDetailsElement).hidden, true);
  } finally {
    page.close();
  }
});

test('in the page: repositories appear one by one, placeholders below them until the last', async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  // GitHub answers Acme/big only once the test lets it.
  const slow: Fetch = async (url, init) => {
    if (url === 'https://api.github.com/repos/Acme/big/commits/main') await held;
    return github(url, init);
  };
  const slowServer = createWebServer({ fetch: slow, token: 'test' });
  await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
  const page = await openPage('/', `http://127.0.0.1:${(slowServer.address() as AddressInfo).port}`);
  try {
    const { document, window } = page;
    const scanning = page.scan('Acme');
    await waitFor(() => document.querySelectorAll('#repositories .repository').length === 1);
    assert.deepEqual(sections(document), [['Acme/app · 2 skills', 'deploy', 'lint']]);
    assert.equal(document.getElementById('status')!.textContent, 'Acme · 5 repositories · 2 skills');
    assert.equal(document.getElementById('commit')!.textContent, '1 of 5 scanned');
    const loading = document.getElementById('loading')!;
    assert.notEqual(window.getComputedStyle(loading).display, 'none');
    assert.ok(document.getElementById('repositories')!.compareDocumentPosition(loading) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal((document.getElementById('scan') as HTMLButtonElement).disabled, true);
    release();
    await scanning;
    // Acme/docs and Acme/empty, no skills, are not shown.
    assert.equal(document.querySelectorAll('#repositories .repository').length, 3);
    assert.equal(document.getElementById('status')!.textContent, 'Acme · 5 repositories · 3 skills');
    assert.equal(window.getComputedStyle(loading).display, 'none');
    assert.equal(document.getElementById('commit')!.textContent, '');
  } finally {
    release();
    page.close();
    slowServer.close();
  }
});

test('in the page: repositories with no skills are not shown, their warnings are; none with skills → a note', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('Bare');
    assert.equal(document.getElementById('status')!.textContent, 'Bare · 2 repositories · 0 skills');
    assert.equal(document.getElementById('commit')!.textContent, '');
    assert.deepEqual(sections(document), []);
    assert.equal(document.querySelector('#repositories .empty')!.textContent, 'No skills in these repositories.');
    assert.deepEqual(
      [...document.querySelectorAll('#warnings li')].map((item) => item.textContent),
      ['warning: Bare/gone: .claude/skills/gone/SKILL.md: listed, but not found at the scanned commit; skipped'],
    );
  } finally {
    page.close();
  }
});

test('the API still streams a line for each repository with no skills', async () => {
  const answer = await lines('Bare');
  assert.deepEqual(
    answer.lines.slice(1).map((line) => [line.repository.id, line.skills, line.warnings.length]),
    [
      ['Bare/gone', [], 1],
      ['Bare/plain', [], 0],
    ],
  );
});

test('in the page: a rate limit stops the scan, what was scanned stays, the reason in the warnings', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('Limited');
    assert.deepEqual(sections(document), [['Limited/a · 1 skill', 'one']]);
    assert.equal(document.getElementById('status')!.textContent, 'Limited · 3 repositories · 1 skill');
    assert.equal((document.getElementById('warnings-box') as HTMLDetailsElement).open, true);
    assert.deepEqual(
      [...document.querySelectorAll('#warnings li')].map((item) => item.textContent),
      ['warning: GitHub rate limit reached; try again in 60 minutes'],
    );
  } finally {
    page.close();
  }
});

test('in the page: an unreachable organization → the error replaces the results', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('Acme');
    await page.scan('nobody');
    assert.equal(document.getElementById('status')!.className, 'error');
    assert.equal(document.getElementById('status')!.textContent, 'Organization not found: https://github.com/nobody');
    assert.equal(document.querySelectorAll('#repositories .repository').length, 0);
  } finally {
    page.close();
  }
});

// spec/web.md, "filter field": the skills shown, narrowed as you type.
/** Types into the filter, as a user would. */
function filter(page: Awaited<ReturnType<typeof openPage>>, text: string) {
  const input = page.document.getElementById('filter') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
}
const shownSkills = (document: Document) =>
  [...document.querySelectorAll<HTMLElement>('#results .skill')].filter((skill) => !skill.hidden).map((skill) => skill.querySelector('.meta')!.textContent);
const shownSections = (document: Document) =>
  [...document.querySelectorAll<HTMLElement>('#repositories .repository')].filter((section) => !section.hidden).map((section) => section.querySelector('h2 a')!.textContent);

test('in the page: the filter field appears once there are skills, and a new scan empties it', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    const box = document.getElementById('filter-box')!;
    const input = document.getElementById('filter') as HTMLInputElement;
    assert.equal(box.hidden, true, 'nothing to filter yet');
    assert.equal(input.type, 'search');
    assert.equal(input.getAttribute('aria-label'), 'Filter skills by name, description, or repository');
    await page.scan('JetBrains/empty');
    assert.equal(box.hidden, true, 'no skills, no filter');
    await page.scan('JetBrains/copies');
    assert.equal(box.hidden, false);
    // The filter sits above the results.
    assert.ok(box.compareDocumentPosition(document.getElementById('skills')!) & page.window.Node.DOCUMENT_POSITION_FOLLOWING);
    filter(page, 'review');
    assert.equal(shownSkills(document).length, 2);
    await page.scan('JetBrains/copies');
    assert.equal(input.value, '');
    assert.equal(shownSkills(document).length, 3);
    assert.equal(document.getElementById('filter-note')!.hidden, true);
  } finally {
    page.close();
  }
});

test('in the page: the filter matches a skill by name or description, every word, case aside', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('JetBrains/copies');
    const note = document.getElementById('filter-note')!;
    assert.equal(note.hidden, true);
    filter(page, 'COMMITS');
    assert.deepEqual(shownSkills(document), ['.agents/skills/commits/SKILL.md']);
    assert.equal(note.hidden, false);
    assert.equal(note.textContent, '1 of 3 skills match');
    // The description, beyond its first sentence too.
    filter(page, 'claude way');
    assert.deepEqual(shownSkills(document), ['.claude/skills/review/SKILL.md']);
    filter(page, 'change review');
    assert.deepEqual(shownSkills(document), ['.agents/skills/review/SKILL.md', '.claude/skills/review/SKILL.md']);
    assert.equal(note.textContent, '2 of 3 skills match');
    filter(page, 'nothing like this');
    assert.deepEqual(shownSkills(document), []);
    assert.equal(note.textContent, 'No skills match “nothing like this”.');
    filter(page, '  ');
    assert.equal(shownSkills(document).length, 3);
    assert.equal(note.hidden, true);
  } finally {
    page.close();
  }
});

test('in the page: the filter matches the repository name; a repository with no match is hidden', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    await page.scan('JetBrains/example');
    filter(page, 'jetbrains/example');
    assert.equal(shownSkills(document).length, 1);
    await page.scan('Acme');
    assert.deepEqual(shownSections(document), ['Acme/app', 'Acme/big', 'Acme/broken']);
    filter(page, 'acme/big');
    assert.deepEqual(shownSections(document), ['Acme/big']);
    assert.deepEqual(shownSkills(document), ['modules/x/.claude/skills/release/SKILL.md']);
    // A skill's name: only its repository's section.
    filter(page, 'deploy');
    assert.deepEqual(shownSections(document), ['Acme/app']);
    assert.deepEqual(shownSkills(document), ['.claude/skills/deploy/SKILL.md']);
    assert.equal(document.getElementById('filter-note')!.textContent, '1 of 3 skills match');
    // A repository that could not be scanned stays while its name matches.
    filter(page, 'broken');
    assert.deepEqual(shownSections(document), ['Acme/broken']);
    assert.equal(document.getElementById('filter-note')!.textContent, 'No skills match “broken”.');
    filter(page, '');
    assert.deepEqual(shownSections(document), ['Acme/app', 'Acme/big', 'Acme/broken']);
  } finally {
    page.close();
  }
});

test('in the page: the filter applies to repositories still coming in', async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const slow: Fetch = async (url, init) => {
    if (url === 'https://api.github.com/repos/Acme/big/commits/main') await held;
    return github(url, init);
  };
  const slowServer = createWebServer({ fetch: slow, token: 'test' });
  await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
  const page = await openPage('/', `http://127.0.0.1:${(slowServer.address() as AddressInfo).port}`);
  try {
    const { document } = page;
    const scanning = page.scan('Acme');
    await waitFor(() => document.querySelectorAll('#repositories .repository').length === 1);
    assert.equal(document.getElementById('filter-box')!.hidden, false);
    filter(page, 'release');
    assert.deepEqual(shownSections(document), []);
    release();
    await scanning;
    assert.deepEqual(shownSections(document), ['Acme/big']);
    assert.deepEqual(shownSkills(document), ['modules/x/.claude/skills/release/SKILL.md']);
  } finally {
    release();
    page.close();
    slowServer.close();
  }
});

test('the page: a neon sunset look, light and dark, drawn in the page with nothing fetched', async () => {
  const html = await (await fetch(base)).text();
  const { document } = new JSDOM(html).window;
  const header = document.querySelector('header')!;
  for (const decoration of ['.sun', '.skyline']) {
    const node = header.querySelector(decoration);
    assert.ok(node, `${decoration} in the header`);
    assert.equal(node.getAttribute('aria-hidden'), 'true', `${decoration} hidden from screen readers`);
  }
  assert.equal(header.querySelector('h1')!.textContent, 'Skill Atlas');
  const css = document.querySelector('style')!.textContent!;
  assert.match(css, /--sky:\s*linear-gradient/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[^}]*--sky:/, 'a night sky for dark');
  assert.match(css, /h1\s*\{[^}]*font-style:\s*italic;[^}]*text-transform:\s*uppercase;[^}]*text-shadow:/);
  // Keyboard focus in the header stands out against the sky, not the pink accent on a pink sunset.
  assert.match(css, /header :focus-visible\s*\{[^}]*outline:\s*3px solid #fff;[^}]*box-shadow:\s*0 0 0 7px #2a0b45/);
  assert.match(css, /\.skill::before\s*\{[^}]*linear-gradient/);
  // Nothing fetched for the look: no external stylesheet, font or image.
  assert.doesNotMatch(html, /@import|@font-face|url\(\s*['"]?https?:/);
  assert.equal(document.querySelectorAll('link[rel="stylesheet"], img').length, 0);
});

// spec/web.md, "Cluster": the skills grouped by what they say, over the mock data (tests/cluster.test.ts: how).
/** A server over the mock data for the time of `run`: JetBrains, its 3 repositories, 10 skills. */
async function withMock(run: (base: string) => Promise<void>, wrap?: (base: string) => ReturnType<typeof createServer>) {
  const mock = createWebServer({ fetch: mockGitHub() });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  const front = wrap?.(mockBase);
  if (front) await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  try {
    await run(front ? `http://127.0.0.1:${(front.address() as AddressInfo).port}` : mockBase);
  } finally {
    front?.close();
    mock.close();
  }
}

const clusterButton = (document: Document) => document.getElementById('cluster') as HTMLButtonElement;
/** Each group shown: its heading, then its skills' names and repositories. */
const groups = (document: Document) =>
  [...document.querySelectorAll<HTMLElement>('#cluster-groups .cluster')].filter((group) => !group.hidden).map((group) => [
    group.querySelector('h2')!.textContent,
    ...[...group.querySelectorAll<HTMLElement>('.skill')].filter((skill) => !skill.hidden).map((skill) => `${skill.querySelector('.name')!.textContent} @ ${skill.querySelector('.repository-name')!.textContent}`),
  ]);
const ALL_GROUPS = [
  ['koog · agent · 3 skills', 'koog-agent @ JetBrains/koog', 'koog-docs @ JetBrains/koog', 'koog-tests @ JetBrains/koog'],
  ['gradle · build · plugin · 3 skills', 'build-tools-bump-gradle-api @ JetBrains/kotlin', 'gradle-plugin-tests @ JetBrains/kotlin', 'mps-build @ JetBrains/MPS'],
  ['Other skills · 4 skills', 'compiler-test-data @ JetBrains/kotlin', 'release-notes @ JetBrains/kotlin', 'stdlib-api-review @ JetBrains/kotlin', 'language-design @ JetBrains/MPS'],
];

test('in the page: the Cluster button appears next to the filter once there are skills', async () => {
  const page = await openPage();
  try {
    const { document } = page;
    const button = clusterButton(document);
    assert.equal(button.hidden, true, 'nothing to cluster yet');
    assert.equal(button.textContent, 'Cluster');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(button.parentElement, document.getElementById('filter-box')!.parentElement, 'next to the filter');
    await page.scan('JetBrains/empty');
    assert.equal(button.hidden, true, 'no skills, nothing to cluster');
    await page.scan('JetBrains/copies');
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
  } finally {
    page.close();
  }
});

test('in the page: Cluster groups the skills of every repository, a section for each group, the rest last', async () => {
  await withMock(async (mockBase) => {
    const page = await openPage('/', mockBase);
    try {
      const { document } = page;
      await page.scan('JetBrains');
      clusterButton(document).click();
      assert.equal(clusterButton(document).getAttribute('aria-pressed'), 'true');
      assert.equal(document.getElementById('clusters')!.hidden, false);
      assert.equal(document.getElementById('repositories')!.hidden, true, 'the list gives way to the groups');
      assert.equal(document.getElementById('cluster-note')!.textContent!.split(':')[0], '2 groups of similar skills, 4 skills in none');
      assert.deepEqual(groups(document), ALL_GROUPS);
      // Each skill once, its card as in the list, its repository named.
      const cards = [...document.querySelectorAll('#cluster-groups .skill')];
      assert.equal(cards.length, 10);
      const mpsBuild = cards.find((card) => card.querySelector('.name')!.textContent === 'mps-build')!;
      assert.equal((mpsBuild.querySelector('.name') as HTMLAnchorElement).href, 'https://github.com/JetBrains/MPS/blob/b2c3d4e5f60718293a4b5c6d7e8f9012345678a1/.claude/skills/mps-build/SKILL.md');
      assert.equal(mpsBuild.querySelector('.meta')!.textContent, 'JetBrains/MPS .claude/skills/mps-build/SKILL.md');
      // Each group's dot in its colour, the colour of its points on the map.
      const swatches = [...document.querySelectorAll<HTMLElement>('#cluster-groups .swatch')].map((swatch) => swatch.style.background);
      assert.equal(new Set(swatches).size, 3);
      // Pressed again: the list as it was.
      clusterButton(document).click();
      assert.equal(clusterButton(document).getAttribute('aria-pressed'), 'false');
      assert.equal(document.getElementById('clusters')!.hidden, true);
      assert.equal(document.getElementById('repositories')!.hidden, false);
      assert.equal(document.querySelectorAll('#cluster-groups .skill').length, 0);
      assert.deepEqual(shownSections(document), ['JetBrains/koog', 'JetBrains/kotlin', 'JetBrains/MPS']);
    } finally {
      page.close();
    }
  });
});

test('in the page: the map, drawn by Plotly: a point for each skill, a trace for each group in its colour', async () => {
  await withMock(async (mockBase) => {
    const page = await openPage('/', mockBase);
    try {
      const { document } = page;
      await page.scan('JetBrains');
      clusterButton(document).click();
      await waitFor(() => page.plotted.length > 0);
      const { data } = page.plotted.at(-1)!;
      assert.deepEqual(
        data.map((trace) => [trace.name, trace.text]),
        [
          ['koog · agent', ['koog-agent', 'koog-docs', 'koog-tests']],
          ['gradle · build · plugin', ['build-tools-bump-gradle-api', 'gradle-plugin-tests', 'mps-build']],
          ['Other skills', ['compiler-test-data', 'release-notes', 'stdlib-api-review', 'language-design']],
        ],
      );
      const swatches = [...document.querySelectorAll<HTMLElement>('#cluster-groups .swatch')].map((swatch) => swatch.style.background);
      const toRgb = (color: string) => { const probe = document.createElement('i'); probe.style.background = color; return probe.style.background; };
      assert.deepEqual(data.map((trace) => toRgb(trace.marker.color)), swatches);
      // Hovering a point: its name, repository and first sentence.
      assert.deepEqual(data[0].customdata[0].slice(1), ['JetBrains/koog', 'Creates a Koog AI agent with its tools and a strategy graph.']);
      for (const trace of data) for (const value of [...trace.x, ...trace.y]) assert.ok(Number.isFinite(value));
    } finally {
      page.close();
    }
  });
});

test('in the page: the filter still applies to the groups and the map; a group with no match is hidden', async () => {
  await withMock(async (mockBase) => {
    const page = await openPage('/', mockBase);
    try {
      const { document } = page;
      await page.scan('JetBrains');
      clusterButton(document).click();
      filter(page, 'gradle');
      assert.deepEqual(groups(document), [
        ['gradle · build · plugin · 3 skills', 'build-tools-bump-gradle-api @ JetBrains/kotlin', 'gradle-plugin-tests @ JetBrains/kotlin', 'mps-build @ JetBrains/MPS'],
      ]);
      assert.equal(document.getElementById('filter-note')!.textContent, '3 of 10 skills match');
      await waitFor(() => page.plotted.at(-1)?.data.flatMap((trace) => trace.text).length === 3);
      assert.deepEqual(page.plotted.at(-1)!.data.map((trace) => trace.text.length), [0, 3, 0]);
      // The groups stay as they were made: a word that matches in two groups shows both.
      filter(page, 'tests');
      assert.deepEqual(groups(document).map((group) => group[0]), ['koog · agent · 3 skills', 'gradle · build · plugin · 3 skills']);
      filter(page, '');
      assert.deepEqual(groups(document), ALL_GROUPS);
    } finally {
      page.close();
    }
  });
});

test('in the page: a new scan goes back to the list; the button waits while a scan runs', async () => {
  await withMock(async (mockBase) => {
    const page = await openPage('/', mockBase);
    try {
      const { document } = page;
      await page.scan('JetBrains');
      clusterButton(document).click();
      const scanning = page.scan('JetBrains/koog');
      assert.equal(clusterButton(document).disabled, true, 'waits while the scan runs');
      assert.equal(document.getElementById('clusters')!.hidden, true);
      await scanning;
      assert.equal(clusterButton(document).disabled, false);
      assert.equal(clusterButton(document).getAttribute('aria-pressed'), 'false');
      assert.equal(document.querySelectorAll('#skills .skill').length, 3);
      // The new scan's skills, not the last one's.
      clusterButton(document).click();
      assert.deepEqual(groups(document), [ALL_GROUPS[0]]);
    } finally {
      page.close();
    }
  });
});

test('in the page: Plotly cannot be loaded → a note where the map would be, the groups below', async () => {
  // In front of the mock server, one that answers 503 for Plotly.
  const blocking = (target: string) =>
    createServer(async (request, response) => {
      if (request.url === '/plotly.min.js') return response.writeHead(503).end();
      const answer = await fetch(new URL(request.url!, target));
      response.writeHead(answer.status, { 'Content-Type': answer.headers.get('content-type') ?? 'text/plain' });
      response.end(Buffer.from(await answer.arrayBuffer()));
    });
  await withMock(async (front) => {
    const page = await openPage('/', front);
    try {
      const { document, window } = page;
      Object.assign(window, { Plotly: undefined });
      await page.scan('JetBrains');
      clusterButton(document).click();
      await waitFor(() => document.querySelector('#cluster-map .problem') !== null);
      assert.equal(document.querySelector('#cluster-map .problem')!.textContent, 'The map could not be drawn: Plotly could not be loaded. The groups are below.');
      assert.deepEqual(groups(document), ALL_GROUPS);
    } finally {
      page.close();
    }
  }, blocking);
});

test('the server: the page loads its scripts from it, Plotly from its package, compressed, kept for a day', async () => {
  const html = await (await fetch(base)).text();
  const { document } = new JSDOM(html).window;
  assert.deepEqual([...document.querySelectorAll('script[src]')].map((script) => script.getAttribute('src')), ['/cluster.js']);
  assert.doesNotMatch(html, /<script[^>]+src=["']?https?:/, 'no script from another site');
  const cluster = await fetch(`${base}/cluster.js`);
  assert.equal(cluster.status, 200);
  assert.equal(cluster.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await cluster.text(), /^var SkillClusters = /m);

  // node:http, not fetch: fetch would decompress it out of sight.
  const plotly = (encoding: string) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      get(`${base}/plotly.min.js`, { headers: { 'accept-encoding': encoding } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  const plain = await plotly('identity');
  const gzip = await plotly('gzip, deflate, br');
  assert.equal(gzip.status, 200);
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.ok(gzip.body.length < plain.body.length / 2, 'compressed');
  assert.deepEqual(gunzipSync(gzip.body), plain.body);
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers['cache-control'], 'public, max-age=86400');
  assert.match(plain.body.subarray(0, 400).toString(), /plotly\.js v\d/);
});
