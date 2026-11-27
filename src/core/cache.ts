import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** A day, in milliseconds: how long the web server keeps what it fetched from GitHub. */
export const DAY = 24 * 60 * 60 * 1000;

/** How many answers the web server keeps: a result is names, descriptions and paths, a few kilobytes. */
export const LIMIT = 20_000;

/** Where `npm start` keeps what it scanned across runs: `~/.skill-atlas`. */
export const CACHE_DIR = join(homedir(), '.skill-atlas');

/** The file in a cache directory, written again shortly after each new answer. */
export const CACHE_FILE = 'cache.json';

/** How long after a new answer the file is written: answers that come together are written together. */
export const SAVE_DELAY = 200;

const VERSION = 1;

export type CacheOptions = {
  /** How long an answer is kept, in milliseconds. */
  ttl?: number;
  /**
   * At most this many answers; the oldest goes first. Each repository of an organization is one, so it must
   * be well above the largest organization: else a second scan finds its first repositories already gone.
   */
  limit?: number;
  /** The clock, in milliseconds; tests pass their own. */
  now?: () => number;
  /**
   * The file the answers are kept in across runs, read when the cache is created; none: in memory only.
   * Each answer must then be plain JSON.
   */
  file?: string;
};

type Entry = { expires: number; value: Promise<unknown>; done?: { value: unknown } };

/**
 * Answers by key, each kept for `ttl` after it was asked for. The same key asked again while the first
 * answer is on its way gets that answer too. A failure is not kept: the next ask tries again.
 * With a `file`, the answers are read from it at the start and written to it after each new one.
 */
export function createCache({ ttl = DAY, limit = LIMIT, now = Date.now, file }: CacheOptions = {}) {
  const entries = new Map<string, Entry>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function prune() {
    // A Map keeps its insertion order, and every entry is kept as long: the first entries expire first.
    // Only the expired ones and the oldest past the limit are looked at, not every entry.
    const time = now();
    for (const [key, entry] of entries) {
      if (entry.expires > time && entries.size < limit) break;
      entries.delete(key);
    }
  }

  if (file) {
    // A missing, unreadable or foreign file is an empty cache: the next save replaces it.
    for (const [key, expires, value] of read(file)) {
      entries.set(key, { expires, value: Promise.resolve(value), done: { value } });
    }
    const time = now();
    for (const [key, entry] of entries) {
      if (entry.expires > time && entries.size <= limit) break;
      entries.delete(key);
    }
  }

  /** Writes the answers that came, unexpired, to the file now; nothing without a file. */
  function save() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!file) return;
    const time = now();
    const kept: [string, number, unknown][] = [];
    for (const [key, entry] of entries) if (entry.done && entry.expires > time) kept.push([key, entry.expires, entry.done.value]);
    try {
      // Written aside, then moved over the old file: a run stopped while writing leaves the old file whole.
      // Only the user may read it: with a token, it lists private repositories.
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const aside = `${file}.${process.pid}.tmp`;
      writeFileSync(aside, JSON.stringify({ version: VERSION, entries: kept }), { mode: 0o600 });
      renameSync(aside, file);
    } catch (error) {
      // A cache that cannot be written is still a cache in memory: the scans go on.
      console.error(`Skill Atlas: could not save the cache to ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function saveSoon() {
    if (!file || timer) return;
    timer = setTimeout(save, SAVE_DELAY);
    // A pending save does not keep the process running: `close()` saves at once.
    timer.unref();
  }

  return {
    get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const entry = entries.get(key);
      if (entry && entry.expires > now()) return entry.value as Promise<T>;
      entries.delete(key);
      prune();
      const value = load();
      const kept: Entry = { expires: now() + ttl, value };
      entries.set(key, kept);
      value.then(
        (done) => {
          if (entries.get(key) !== kept) return;
          kept.done = { value: done };
          saveSoon();
        },
        () => {
          if (entries.get(key) === kept) entries.delete(key);
        },
      );
      return value;
    },
    get size() {
      return entries.size;
    },
    /** Writes a pending save now: when the server stops. */
    close() {
      if (timer) save();
    },
  };
}

/** The entries of a cache file, `[key, expires, value]`; none if it is missing or not one. */
function read(file: string): [string, number, unknown][] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== VERSION) return [];
  const list = (data as { entries?: unknown }).entries;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is [string, number, unknown] => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'number')
    .sort((a, b) => a[1] - b[1]);
}

export type Cache = ReturnType<typeof createCache>;
