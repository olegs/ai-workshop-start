// spec/analysis.md, "Organization", and spec/cli.md: an organization's repositories scanned one by one,
// checked on what the real command prints, with GitHub answering from the recording in tests/helpers.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHubOrganization, parseGitHubOrganizationUrl, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { atlas, commitIn, github } from './helpers.ts';

const link = (id: string, path: string) => `https://github.com/${id}/blob/${commitIn(id)}/${path}`;

test('an organization is github.com/<owner>, with or without the scheme or a slash; owner/repo is a repository', () => {
  for (const input of ['https://github.com/JetBrains', 'github.com/JetBrains/', 'https://www.github.com/JetBrains', 'https://github.com/orgs/JetBrains']) {
    assert.equal(parseGitHubOrganizationUrl(input), 'JetBrains', input);
  }
  for (const input of ['https://github.com/JetBrains/kotlin', 'JetBrains', './JetBrains', 'https://gitlab.com/JetBrains']) {
    assert.equal(parseGitHubOrganizationUrl(input), undefined, input);
  }
  assert.equal(parseGitHubUrl('https://github.com/JetBrains'), undefined);
});

test('scan <organization>: the count, then each repository by name with its skills; one that fails is a warning', async () => {
  const { code, stdout, stderr } = await atlas(['scan', 'https://github.com/acme']);
  assert.equal(code, 0, stderr);
  assert.equal(
    stdout,
    [
      'Acme · 5 repositories',
      '',
      'Acme/app · 2 skills',
      'deploy — Deploy the app.',
      `  ${link('Acme/app', '.claude/skills/deploy/SKILL.md')}`,
      'lint — Lint the web module.',
      `  ${link('Acme/app', 'web/.agents/skills/lint/SKILL.md')}`,
      '',
      // The tree is too large for one answer: with a token, code search finds the module's skill.
      'Acme/big · 1 skill',
      'release — Release a module.',
      `  ${link('Acme/big', 'modules/x/.claude/skills/release/SKILL.md')}`,
      '',
      // docs/SKILL.md is not a project skill.
      'Acme/docs · 0 skills',
      '',
      // No commits yet: no skills, not an error.
      'Acme/empty · 0 skills',
    ].join('\n'),
  );
  assert.equal(stderr, 'warning: Acme/broken: GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error; skipped');
});

test("scan <organization>: each repository is printed as soon as it is scanned, before the next one's is asked for", async () => {
  const events: string[] = [];
  const logged: Fetch = (url, init) => {
    const repository = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/commits\//.exec(url)?.[1];
    if (repository) events.push(`scan ${repository}`);
    return github(url, init);
  };
  const code = await run(['scan', 'github.com/Acme'], {
    open: () => assert.fail('not a repository'),
    organization: (input) => openGitHubOrganization(input, { fetch: logged, token: 'test' }),
    print: (text) => {
      if (/ · \d+ skills?$/.test(text)) events.push(`print ${text.split(' ')[0]}`);
    },
    error: (text) => events.push(`error ${text.split(' ')[1]}`),
  });
  assert.equal(code, 0);
  assert.deepEqual(events, [
    'scan Acme/app',
    'print Acme/app',
    'scan Acme/big',
    'print Acme/big',
    'scan Acme/broken',
    'error Acme/broken:',
    'scan Acme/docs',
    'print Acme/docs',
    'scan Acme/empty',
    'print Acme/empty',
  ]);
});

test("a user's repositories, like an organization's", async () => {
  const { code, stdout } = await atlas(['scan', 'https://github.com/solo']);
  assert.equal(code, 0);
  assert.equal(
    stdout,
    ['solo · 1 repository', '', 'solo/dotfiles · 1 skill', 'shell — Edit shell scripts.', `  ${link('solo/dotfiles', '.claude/skills/shell/SKILL.md')}`].join('\n'),
  );
});

test('rate limit in the middle → what was scanned stays, the scan stops with the message, exit code 1', async () => {
  const { code, stdout, stderr } = await atlas(['scan', 'https://github.com/Limited']);
  assert.equal(code, 1);
  assert.equal(
    stdout,
    ['Limited · 3 repositories', '', 'Limited/a · 1 skill', 'one — The first skill.', `  ${link('Limited/a', '.claude/skills/one/SKILL.md')}`].join('\n'),
  );
  assert.equal(stderr, 'GitHub rate limit reached; try again in a minute');
});

test('unreachable organization → a clear message, exit code 1', async () => {
  const missing = await atlas(['scan', 'https://github.com/nobody']);
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, 'Organization not found: https://github.com/nobody');

  const offline = await atlas(['scan', 'https://github.com/not-answered']);
  assert.equal(offline.code, 1);
  assert.equal(offline.stderr, 'Cannot reach GitHub: not recorded: https://api.github.com/users/not-answered');
});

test('an organization with no repositories → `0 repositories`, exit code 0', async () => {
  const none = replay({
    'https://api.github.com/users/Quiet': { status: 200, body: { login: 'Quiet', type: 'Organization' } },
    'https://api.github.com/orgs/Quiet/repos?per_page=100&page=1': { status: 200, body: [] },
  });
  const { code, stdout, stderr } = await atlas(['scan', 'https://github.com/Quiet'], none);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, 'Quiet · 0 repositories');
});

test('every page of the list: a hundred repositories a page, sorted by name whatever the case', async () => {
  const names = Array.from({ length: 101 }, (_, index) => `Many/repo-${String(index).padStart(3, '0')}`);
  const listed = (ids: string[]) => ids.map((id) => ({ full_name: id, default_branch: 'main' }));
  const many = replay({
    'https://api.github.com/users/Many': { status: 200, body: { login: 'Many', type: 'Organization' } },
    'https://api.github.com/orgs/Many/repos?per_page=100&page=1': { status: 200, body: listed([...names.slice(1, 100).reverse(), 'Many/Zeta']) },
    'https://api.github.com/orgs/Many/repos?per_page=100&page=2': { status: 200, body: listed([names[0], 'Many/alpha']) },
  });
  const organization = await openGitHubOrganization('https://github.com/Many', { fetch: many });
  const ids = organization.repositories.map((repository) => repository.id);
  assert.equal(ids.length, 102);
  assert.deepEqual(ids.slice(0, 2), ['Many/alpha', 'Many/repo-000']);
  assert.equal(ids.at(-1), 'Many/Zeta');
});

test('the help lists the organization form', async () => {
  const { stdout } = await atlas(['help']);
  assert.match(stdout, /for https:\/\/github\.com\/<organization>, in each of its repositories/);
});
