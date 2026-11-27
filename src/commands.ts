// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import type { Organization } from './core/github.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { scanOrganization } from './core/organization.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  /** Opens an organization, if that is what the input is: `https://github.com/<owner>`. */
  organization?(input: string): Promise<Organization> | undefined;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it;
                                  for https://github.com/<organization>, in each of its repositories
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  if (args.length !== 1) throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory>');
  const organization = context.organization?.(args[0]);
  if (organization) return scanOrganizationCommand(await organization, context);
  const result = await scan(await context.open(args[0]));
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

/**
 * `<organization> · N repositories`, then each repository with skills as soon as it is scanned;
 * a repository with no skills is not shown, its warnings are.
 */
async function scanOrganizationCommand(organization: Organization, context: Context) {
  const count = organization.repositories.length;
  context.print(`${organization.id} · ${count} ${count === 1 ? 'repository' : 'repositories'}`);
  for await (const { repository, result, error } of scanOrganization(organization)) {
    if (error !== undefined) {
      context.error(`warning: ${repository.id}: ${error}; skipped`);
      continue;
    }
    if (result.skills.length > 0) {
      context.print('');
      printRepository(result.repository, result.skills, context);
    }
    for (const warning of result.warnings) context.error(`warning: ${repository.id}: ${warning}`);
  }
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

/** Abbreviations whose `.` never ends a sentence, even before a capital: "e.g. JSON". */
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'cf', 'vs', 'viz', 'a.k.a', 'approx', 'incl', 'esp', 'resp', 'etc']);

/**
 * The text up to the first `.`, `!` or `?` before a space or the end that ends a sentence: a `.` after an abbreviation
 * ("e.g.", "i.e.", "vs.") or before a lowercase word or a digit ("approx. 5") does not.
 */
export function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  for (const end of line.matchAll(/[.!?](?=\s|$)/g)) {
    const at = end.index + 1;
    if (end[0] === '.' && at < line.length) {
      const word = /(?:^|[\s(])([^\s(]*)$/.exec(line.slice(0, end.index))![1].toLowerCase();
      const next = line.slice(at + 1);
      if (ABBREVIATIONS.has(word) && !(word === 'etc' && /^\p{Lu}/u.test(next))) continue;
      if (/^[\p{Ll}\d]/u.test(next)) continue;
    }
    return line.slice(0, at);
  }
  return line;
}
