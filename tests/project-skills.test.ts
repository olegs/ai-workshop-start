// spec/analysis.md, "Project skill": which SKILL.md files are a repository's skills, checked on
// what the real command prints for small repositories, local and on GitHub.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { atlas } from './helpers.ts';

const scratch = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const skill = (name: string, description = `The ${name} skill.`) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

/** A local repository with these files; scanned, its output with the file:// prefix as `<repo>`. */
async function scanFiles(name: string, files: Record<string, string>, links: Record<string, string> = {}) {
  const root = join(scratch, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path));
  }
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  return { ...result, stdout: result.stdout.replaceAll(pathToFileURL(root).href, '<repo>') };
}

test('a skill in each agent folder: .agents, .claude, .github and agent', async () => {
  const { stdout } = await scanFiles('roots', {
    '.agents/skills/a/SKILL.md': skill('a'),
    '.claude/skills/b/SKILL.md': skill('b'),
    '.github/skills/c/SKILL.md': skill('c'),
    'agent/skills/d/SKILL.md': skill('d'),
  });
  assert.equal(
    stdout,
    [
      'roots · 4 skills',
      'a — The a skill.',
      '  <repo>/.agents/skills/a/SKILL.md',
      'b — The b skill.',
      '  <repo>/.claude/skills/b/SKILL.md',
      'c — The c skill.',
      '  <repo>/.github/skills/c/SKILL.md',
      'd — The d skill.',
      '  <repo>/agent/skills/d/SKILL.md',
    ].join('\n'),
  );
});

test("a module's skill folder, anywhere in the repository, is the project's too", async () => {
  const { stdout } = await scanFiles('monorepo', {
    'plugins/kotlin/.claude/skills/k2/SKILL.md': skill('k2'),
    'community/.agents/skills/build/SKILL.md': skill('build'),
  });
  assert.equal(
    stdout,
    [
      'monorepo · 2 skills',
      'build — The build skill.',
      '  <repo>/community/.agents/skills/build/SKILL.md',
      'k2 — The k2 skill.',
      '  <repo>/plugins/kotlin/.claude/skills/k2/SKILL.md',
    ].join('\n'),
  );
});

test('not a project skill: outside a skill folder, directly in it, deeper in a skill, case, dependencies', async () => {
  const { stdout, stderr } = await scanFiles('ignored', {
    '.claude/skills/kept/SKILL.md': skill('kept'),
    'SKILL.md': skill('repository-root'),
    'docs/SKILL.md': skill('docs'),
    'testData/skills/fake/SKILL.md': skill('test-data'),
    'skills/published/SKILL.md': skill('collection'),
    'plugins/p/skills/s/SKILL.md': skill('plugin'),
    '.claude/SKILL.md': skill('agent-folder'),
    '.claude/skills/SKILL.md': skill('skill-folder'),
    '.claude/skills/kept/templates/SKILL.md': skill('template'),
    '.claude/skills/kept/examples/.claude/skills/nested/SKILL.md': skill('example'),
    '.claude/skills/agent/skills/inner/SKILL.md': skill('inside-a-skill-named-agent'),
    '.claude/skills/kept/.github/skills/inner/SKILL.md': skill('inside-the-kept-skill'),
    '.claude/skills/lower/skill.md': skill('lowercase'),
    '.claude/skills/upper/Skill.md': skill('mixed-case'),
    '.GitHub/skills/folder-case/SKILL.md': skill('folder-case'),
    'Agent/Skills/folder-case/SKILL.md': skill('folder-case-too'),
    'node_modules/pkg/.claude/skills/dep/SKILL.md': skill('dependency'),
  });
  assert.equal(stdout, ['ignored · 1 skill', 'kept — The kept skill.', '  <repo>/.claude/skills/kept/SKILL.md'].join('\n'));
  assert.equal(stderr, '');
});

test("a Git submodule or a nested checkout is another repository: its skills are not this one's", async () => {
  const { stdout, stderr } = await scanFiles('submodules', {
    '.claude/skills/own/SKILL.md': skill('own'),
    // A submodule's checkout has a .git file; a nested clone, a .git directory.
    'vendor/lib/.git': 'gitdir: ../../.git/modules/vendor/lib\n',
    'vendor/lib/.claude/skills/lib-skill/SKILL.md': skill('lib-skill'),
    'tools/clone/.git/HEAD': 'ref: refs/heads/main\n',
    'tools/clone/.agents/skills/clone-skill/SKILL.md': skill('clone-skill'),
  });
  assert.equal(stdout, ['submodules · 1 skill', 'own — The own skill.', '  <repo>/.claude/skills/own/SKILL.md'].join('\n'));
  assert.equal(stderr, '');
});

test('a symbolic link is not a skill of its own: the target is scanned where it is', async () => {
  const { stdout } = await scanFiles(
    'links',
    { '.agents/skills/shared/SKILL.md': skill('shared') },
    { '.claude/skills': '../.agents/skills', '.github/skills/linked/SKILL.md': '../../../.agents/skills/shared/SKILL.md' },
  );
  assert.equal(stdout, ['links · 1 skill', 'shared — The shared skill.', '  <repo>/.agents/skills/shared/SKILL.md'].join('\n'));
});

test('copies: the same bytes under another agent folder → one skill, also in; the first folder stays', async () => {
  const { stdout } = await scanFiles('copies', {
    '.github/skills/commits/SKILL.md': skill('commits'),
    '.claude/skills/commits/SKILL.md': skill('commits'),
    '.agents/skills/commits/SKILL.md': skill('commits'),
  });
  assert.equal(
    stdout,
    [
      'copies · 1 skill',
      'commits — The commits skill.',
      '  <repo>/.agents/skills/commits/SKILL.md',
      '  also in .claude/skills/commits/SKILL.md, .github/skills/commits/SKILL.md',
    ].join('\n'),
  );
});

test('not copies: different bytes, or the same skill in another module → separate skills', async () => {
  const { stdout } = await scanFiles('different', {
    '.agents/skills/commits/SKILL.md': skill('commits', 'Short commit messages.'),
    '.claude/skills/commits/SKILL.md': skill('commits', 'Long commit messages.'),
    'module/.claude/skills/style/SKILL.md': skill('style'),
    '.claude/skills/style/SKILL.md': skill('style'),
  });
  assert.equal(
    stdout,
    [
      'different · 4 skills',
      'commits — Short commit messages.',
      '  <repo>/.agents/skills/commits/SKILL.md',
      'commits — Long commit messages.',
      '  <repo>/.claude/skills/commits/SKILL.md',
      'style — The style skill.',
      '  <repo>/.claude/skills/style/SKILL.md',
      'style — The style skill.',
      '  <repo>/module/.claude/skills/style/SKILL.md',
    ].join('\n'),
  );
});

test('the name: front matter, else the directory; no front matter or description → the name alone', async () => {
  const { stdout, stderr } = await scanFiles('names', {
    '.claude/skills/dir-name/SKILL.md': skill('front-matter-name'),
    '.claude/skills/plain/SKILL.md': '# Just Markdown\n',
    '.claude/skills/terse/SKILL.md': '---\nname: terse\n---\n',
  });
  assert.equal(
    stdout,
    [
      'names · 3 skills',
      'front-matter-name — The front-matter-name skill.',
      '  <repo>/.claude/skills/dir-name/SKILL.md',
      'plain',
      '  <repo>/.claude/skills/plain/SKILL.md',
      'terse',
      '  <repo>/.claude/skills/terse/SKILL.md',
    ].join('\n'),
  );
  assert.equal(stderr, 'warning: .claude/skills/plain/SKILL.md: no front matter; using the directory name');
});

// The same rules on GitHub, through the tree: no token.
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const API = 'https://api.github.com/repos/JetBrains/tree';
const RAW = `https://raw.githubusercontent.com/JetBrains/tree/${COMMIT}`;
const blob = (path: string) => ({ path, mode: '100644', type: 'blob', sha: path });

async function scanGitHub(recording: Recording) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['scan', 'https://github.com/JetBrains/tree'], {
    open: (input) => openGitHub(input, { fetch: replay(recording) }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const repository: Recording = {
  [API]: { status: 200, body: { full_name: 'JetBrains/tree', default_branch: 'main' } },
  [`${API}/commits/main`]: { status: 200, body: { sha: COMMIT } },
};

test('GitHub: the same rules on the tree; symbolic links, submodules and dependencies are left out', async () => {
  const result = await scanGitHub({
    ...repository,
    [`${API}/git/trees/${COMMIT}?recursive=1`]: {
      status: 200,
      body: {
        truncated: false,
        tree: [
          blob('.agents/skills/commits/SKILL.md'),
          blob('.claude/skills/commits/SKILL.md'),
          { path: '.github/skills', mode: '120000', type: 'blob', sha: 'link' },
          blob('module/.claude/skills/style/SKILL.md'),
          blob('docs/SKILL.md'),
          blob('node_modules/pkg/.claude/skills/dep/SKILL.md'),
          { path: '.claude/skills/linked/SKILL.md', mode: '120000', type: 'blob', sha: 'link' },
          { path: 'vendor/lib', mode: '160000', type: 'commit', sha: 'submodule' },
          blob('.claude/skills/agent/skills/inner/SKILL.md'),
        ],
      },
    },
    [`${RAW}/.agents/skills/commits/SKILL.md`]: { status: 200, body: skill('commits') },
    [`${RAW}/.claude/skills/commits/SKILL.md`]: { status: 200, body: skill('commits') },
    [`${RAW}/module/.claude/skills/style/SKILL.md`]: { status: 200, body: skill('style') },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'JetBrains/tree · 2 skills',
      'commits — The commits skill.',
      `  https://github.com/JetBrains/tree/blob/${COMMIT}/.agents/skills/commits/SKILL.md`,
      '  also in .claude/skills/commits/SKILL.md',
      'style — The style skill.',
      `  https://github.com/JetBrains/tree/blob/${COMMIT}/module/.claude/skills/style/SKILL.md`,
    ].join('\n'),
  );
  assert.equal(result.stderr, '');
});

test("GitHub: a tree too large for one answer, no token → only the root's skill folders, a warning", async () => {
  const tree = (sha: string, entries: object[], truncated = false) => ({
    [`${API}/git/trees/${sha}`]: { status: 200, body: { truncated, tree: entries } },
  });
  const result = await scanGitHub({
    ...repository,
    [`${API}/git/trees/${COMMIT}?recursive=1`]: { status: 200, body: { truncated: true, tree: [] } },
    ...tree(COMMIT, [{ path: '.claude', mode: '040000', type: 'tree', sha: 'claude' }]),
    ...tree('claude', [{ path: 'skills', mode: '040000', type: 'tree', sha: 'skills' }]),
    [`${API}/git/trees/skills?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: [blob('commits/SKILL.md'), blob('commits/templates/SKILL.md')] },
    },
    [`${RAW}/.claude/skills/commits/SKILL.md`]: { status: 200, body: skill('commits') },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'JetBrains/tree · 1 skill',
      'commits — The commits skill.',
      `  https://github.com/JetBrains/tree/blob/${COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
  assert.equal(
    result.stderr,
    'warning: the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills (GITHUB_TOKEN searches everywhere)',
  );
});
