// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE and ORGANIZATIONS below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganizationUrl, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
};

const API = 'https://api.github.com';
const skillText = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

/** The commit GitHub answers for a repository of the organizations below. */
export const commitIn = (id: string) => (id.replace(/\W/g, '').toLowerCase() + '0'.repeat(40)).slice(0, 40);

/** A repository as GitHub answers it, scanned through the tree after its organization listed it. */
function repository(id: string, files: Record<string, string>, options: { truncated?: boolean } = {}): Recording {
  const sha = commitIn(id);
  const tree = Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: '0' }));
  return {
    [`${API}/repos/${id}/commits/main`]: { status: 200, body: { sha } },
    [`${API}/repos/${id}/git/trees/${sha}?recursive=1`]: {
      status: 200,
      body: { truncated: options.truncated ?? false, tree: options.truncated ? tree.slice(0, 1) : tree },
    },
    ...Object.fromEntries(
      Object.entries(files).map(([path, text]) => [`https://raw.githubusercontent.com/${id}/${sha}/${path}`, { status: 200, body: text }]),
    ),
  };
}

/** What an organization's repository list says about each. */
const listed = (...ids: string[]) => ids.map((id) => ({ full_name: id, default_branch: 'main' }));

/**
 * Acme, an organization, listed out of order: Acme/app has two skills; Acme/big has a tree too large for
 * one answer, its skill found through code search; Acme/broken cannot be scanned; Acme/docs has no
 * skills; Acme/empty has no commits.
 * solo, a user with one repository. Limited, an organization whose second repository hits a rate limit
 * that resets in an hour.
 * Bare, an organization with no skills at all: Bare/gone's tree is too large, code search lists a SKILL.md
 * that is not there at the scanned commit, a warning; Bare/plain has none.
 * nobody: not on GitHub.
 */
const ORGANIZATIONS: Recording = {
  [`${API}/users/Acme`]: { status: 200, body: { login: 'Acme', type: 'Organization' } },
  [`${API}/users/acme`]: { status: 200, body: { login: 'Acme', type: 'Organization' } },
  [`${API}/orgs/Acme/repos?per_page=100&page=1`]: { status: 200, body: listed('Acme/docs', 'Acme/app', 'Acme/empty', 'Acme/broken', 'Acme/big') },
  ...repository('Acme/app', {
    'README.md': '# app\n',
    '.claude/skills/deploy/SKILL.md': skillText('deploy', 'Deploy the app. Only from main.'),
    'web/.agents/skills/lint/SKILL.md': skillText('lint', 'Lint the web module.'),
  }),
  ...repository('Acme/big', { 'README.md': '# big\n', 'modules/x/.claude/skills/release/SKILL.md': skillText('release', 'Release a module.') }, { truncated: true }),
  [`${API}/search/code?q=filename:SKILL.md+repo:Acme/big&per_page=100&page=1`]: {
    status: 200,
    body: { total_count: 1, items: [{ path: 'modules/x/.claude/skills/release/SKILL.md' }] },
  },
  [`${API}/repos/Acme/broken/commits/main`]: { status: 500, body: { message: 'Server Error' } },
  ...repository('Acme/docs', { 'README.md': '# docs\n', 'docs/SKILL.md': skillText('not-a-skill', 'Documentation.') }),
  [`${API}/repos/Acme/empty/commits/main`]: { status: 409, body: { message: 'Git Repository is empty.' } },

  [`${API}/users/solo`]: { status: 200, body: { login: 'solo', type: 'User' } },
  [`${API}/users/solo/repos?per_page=100&page=1`]: { status: 200, body: listed('solo/dotfiles') },
  ...repository('solo/dotfiles', { '.claude/skills/shell/SKILL.md': skillText('shell', 'Edit shell scripts.') }),

  [`${API}/users/Limited`]: { status: 200, body: { login: 'Limited', type: 'Organization' } },
  [`${API}/orgs/Limited/repos?per_page=100&page=1`]: { status: 200, body: listed('Limited/a', 'Limited/b', 'Limited/c') },
  ...repository('Limited/a', { '.claude/skills/one/SKILL.md': skillText('one', 'The first skill.') }),
  // An hour to wait: too long to wait out, the scan stops.
  [`${API}/repos/Limited/b/commits/main`]: {
    status: 403,
    headers: { 'retry-after': '3600' },
    body: { message: 'API rate limit exceeded for user ID 1.' },
  },
  ...repository('Limited/c', { '.claude/skills/three/SKILL.md': skillText('three', 'Never scanned.') }),

  [`${API}/users/Bare`]: { status: 200, body: { login: 'Bare', type: 'Organization' } },
  [`${API}/orgs/Bare/repos?per_page=100&page=1`]: { status: 200, body: listed('Bare/plain', 'Bare/gone') },
  ...repository('Bare/gone', { 'README.md': '# gone\n' }, { truncated: true }),
  [`${API}/search/code?q=filename:SKILL.md+repo:Bare/gone&per_page=100&page=1`]: {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/gone/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/Bare/gone/${commitIn('Bare/gone')}/.claude/skills/gone/SKILL.md`]: { status: 404, body: '404: Not Found' },
  ...repository('Bare/plain', { 'README.md': '# plain\n' }),

  [`${API}/users/nobody`]: { status: 404, body: { message: 'Not Found' } },
};

export const github = replay({ ...EXAMPLE, ...ORGANIZATIONS });

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE and ORGANIZATIONS above. */
export async function atlas(args: string[], fetch: Fetch = github) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    // With a token, through code search, as EXAMPLE answers it.
    open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token: 'test' }) : openDirectory(input)),
    organization: (input) => (parseGitHubOrganizationUrl(input) ? openGitHubOrganization(input, { fetch, token: 'test' }) : undefined),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
