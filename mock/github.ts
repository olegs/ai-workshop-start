// The mock data for demos: what GitHub answers for the repositories the page offers to try, the same every time,
// so each demo shows the same skills. No request reaches the network: anything else is "not recorded".
import type { Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** A skill: its SKILL.md's name and description; `copies` are other paths with the same bytes. */
type MockSkill = { path: string; name: string; description: string; copies?: string[] };
type MockRepository = { id: string; commit: string; skills: MockSkill[] };

/** JetBrains, an organization, and its three repositories: the page's examples. */
export const MOCK_ORGANIZATION = 'JetBrains';
export const MOCK_REPOSITORIES: MockRepository[] = [
  {
    id: 'JetBrains/kotlin',
    commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    skills: [
      {
        path: '.claude/skills/build-tools-bump-gradle-api/SKILL.md',
        name: 'build-tools-bump-gradle-api',
        description: 'Bumps the Gradle API version that Kotlin Gradle plugins are compiled against. Use when a new Gradle release is out.',
      },
      {
        path: '.claude/skills/compiler-test-data/SKILL.md',
        name: 'compiler-test-data',
        description: 'Regenerates the compiler test data after a change to diagnostics. Run it before pushing.',
        copies: ['.agents/skills/compiler-test-data/SKILL.md'],
      },
      {
        path: '.claude/skills/gradle-plugin-tests/SKILL.md',
        name: 'gradle-plugin-tests',
        description: 'Runs the Kotlin Gradle plugin integration tests for one Gradle version. Slow: pick the tests first.',
      },
      {
        path: '.claude/skills/release-notes/SKILL.md',
        name: 'release-notes',
        description: 'Drafts the release notes from the merged pull requests of a milestone.',
      },
      {
        path: 'libraries/stdlib/.claude/skills/stdlib-api-review/SKILL.md',
        name: 'stdlib-api-review',
        description: 'Checks a new standard library API against the API guidelines. Use for every public declaration.',
      },
    ],
  },
  {
    id: 'JetBrains/MPS',
    commit: 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1',
    skills: [
      {
        path: '.claude/skills/language-design/SKILL.md',
        name: 'language-design',
        description: 'Designs a new MPS language: its concepts, editors and generator. Start from the structure.',
      },
      {
        path: '.claude/skills/mps-build/SKILL.md',
        name: 'mps-build',
        description: 'Builds MPS from source with Gradle and runs it. Use after switching branches.',
      },
    ],
  },
  {
    id: 'JetBrains/koog',
    commit: 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2',
    skills: [
      {
        path: '.claude/skills/koog-agent/SKILL.md',
        name: 'koog-agent',
        description: 'Creates a Koog AI agent with its tools and a strategy graph.',
      },
      {
        path: '.claude/skills/koog-tests/SKILL.md',
        name: 'koog-tests',
        description: 'Writes tests for a Koog agent with mocked LLM answers. No network in tests.',
      },
      {
        path: '.github/skills/koog-docs/SKILL.md',
        name: 'koog-docs',
        description: 'Updates the documentation of a Koog module and its examples.',
      },
    ],
  },
];

// Quoted: a description with a colon is still one line of YAML.
const skillText = (skill: MockSkill) => `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n# ${skill.name}\n`;

/** A repository as GitHub answers it, on its own or listed by its organization, through the tree: no token. */
function repository({ id, commit, skills }: MockRepository): Recording {
  const files: Record<string, string> = { 'README.md': `# ${id.split('/')[1]}\n` };
  for (const skill of skills) for (const path of [skill.path, ...(skill.copies ?? [])]) files[path] = skillText(skill);
  return {
    [`${API}/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: 'main' } },
    [`${API}/repos/${id}/commits/main`]: { status: 200, body: { sha: commit } },
    [`${API}/repos/${id}/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: '0' })) },
    },
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`${RAW}/${id}/${commit}/${path}`, { status: 200, body: text }])),
  };
}

/** Every mocked answer, by request URL. */
export const MOCK_RECORDING: Recording = {
  [`${API}/users/${MOCK_ORGANIZATION}`]: { status: 200, body: { login: MOCK_ORGANIZATION, type: 'Organization' } },
  [`${API}/orgs/${MOCK_ORGANIZATION}/repos?per_page=100&page=1`]: {
    status: 200,
    body: MOCK_REPOSITORIES.map(({ id }) => ({ full_name: id, default_branch: 'main' })),
  },
  ...Object.assign({}, ...MOCK_REPOSITORIES.map(repository)),
};

/** GitHub answering from the mock data, each answer after `delay` ms, as if over the network. */
export function mockGitHub(delay = 0): Fetch {
  const answer = replay(MOCK_RECORDING);
  return async (url, init) => {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return answer(url, init);
  };
}
