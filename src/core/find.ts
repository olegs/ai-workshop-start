/** A project skill's SKILL.md, before it is read: see spec/analysis.md, "Project skill". */
export type SkillFile = {
  path: string;
  /** Its directory, directly in the skill folder. */
  name: string;
  /** The directory the skill folder is in: '' for the repository root. */
  scope: string;
  /** The skill folder, one of SKILL_ROOTS. */
  root: string;
};

/** Where agents keep a repository's own skills; a copy keeps the first one's place. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** Dependencies and Git's own files: never the project's skills. */
const EXCLUDED = new Set(['node_modules', '.git']);

/**
 * Every `<scope>/<root>/<name>/SKILL.md`, in a stable order: by scope, by name, then by root in
 * SKILL_ROOTS order, so the first of a skill's copies is the one that stays.
 */
export function findSkills(paths: string[]): SkillFile[] {
  return paths
    .flatMap((path) => {
      const file = skillFile(path);
      return file ? [file] : [];
    })
    .sort((a, b) => compare(a.scope, b.scope) || compare(a.name, b.name) || SKILL_ROOTS.indexOf(a.root) - SKILL_ROOTS.indexOf(b.root));
}

function skillFile(path: string): SkillFile | undefined {
  const segments = path.split('/');
  if (segments.length < 4 || segments.at(-1) !== 'SKILL.md') return undefined;
  if (segments.some((segment) => EXCLUDED.has(segment))) return undefined;
  const name = segments.at(-2)!;
  const root = segments.slice(-4, -2).join('/');
  if (!name || !SKILL_ROOTS.includes(root)) return undefined;
  const scope = segments.slice(0, -4);
  // A skill folder above it: `<root>/<name>/…/SKILL.md` is one of that skill's own files, even when
  // `…` ends in what looks like a skill folder (`.claude/skills/agent/skills/x/SKILL.md`).
  if (scope.some((_, index) => SKILL_ROOTS.includes(scope.slice(index, index + 2).join('/')))) return undefined;
  return { path, name, scope: scope.join('/'), root };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
