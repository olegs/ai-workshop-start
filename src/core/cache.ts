/** A day, in milliseconds: how long the web server keeps what it fetched from GitHub. */
export const DAY = 24 * 60 * 60 * 1000;

/** How many answers the web server keeps: a result is names, descriptions and paths, a few kilobytes. */
export const LIMIT = 20_000;

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
};

/**
 * Answers by key, each kept for `ttl` after it was asked for. The same key asked again while the first
 * answer is on its way gets that answer too. A failure is not kept: the next ask tries again.
 */
export function createCache({ ttl = DAY, limit = LIMIT, now = Date.now }: CacheOptions = {}) {
  const entries = new Map<string, { expires: number; value: Promise<unknown> }>();

  function prune() {
    // A Map keeps its insertion order, and every entry is kept as long: the first entries expire first.
    // Only the expired ones and the oldest past the limit are looked at, not every entry.
    const time = now();
    for (const [key, entry] of entries) {
      if (entry.expires > time && entries.size < limit) break;
      entries.delete(key);
    }
  }

  return {
    get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const entry = entries.get(key);
      if (entry && entry.expires > now()) return entry.value as Promise<T>;
      entries.delete(key);
      prune();
      const value = load();
      const kept = { expires: now() + ttl, value };
      entries.set(key, kept);
      value.catch(() => {
        if (entries.get(key) === kept) entries.delete(key);
      });
      return value;
    },
    get size() {
      return entries.size;
    },
  };
}

export type Cache = ReturnType<typeof createCache>;
