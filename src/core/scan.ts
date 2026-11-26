import { findSkills, type SkillFile } from './find.ts';
import { sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const contents = await Promise.all(files.map((file) => source.read(file.path)));
  const warnings = [...source.warnings];
  const skills: Skill[] = [];
  // A copy: the same scope and name, the same bytes. findSkills puts the one that stays first.
  const kept = new Map<string, Skill>();
  files.forEach((file, index) => {
    const bytes = contents[index];
    if (!bytes) {
      warnings.push(`${file.path}: listed, but not found at the scanned commit; skipped`);
      return;
    }
    // windows-1252 maps every byte to its own character: equal keys, equal bytes.
    const key = JSON.stringify([file.scope, file.name, new TextDecoder('windows-1252').decode(bytes)]);
    const original = kept.get(key);
    if (original) {
      original.copies.push(file.path);
      return;
    }
    const { skill, warning } = toSkill(source, file, new TextDecoder().decode(bytes));
    kept.set(key, skill);
    skills.push(skill);
    if (warning) warnings.push(warning);
  });
  return { repository: source.repository, skills: sortSkills(skills), warnings };
}

function toSkill(source: Source, file: SkillFile, text: string): { skill: Skill; warning?: string } {
  const parsed = parseSkill(text);
  const skill: Skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: [],
  };
  return { skill, warning: parsed.warning && `${file.path}: ${parsed.warning}` };
}
