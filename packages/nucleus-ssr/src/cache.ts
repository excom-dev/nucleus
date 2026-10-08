import type { Diagnostics } from "./diagnostics";
import { builtin, sha256 } from "./node";

export interface PrerenderCache {
  /** Directory of the cache: kept between runs (a CI cache), never `out`. */
  dir: string;
  /**
   * Whatever else the pages are built from: the app code `entry` loads, the
   * functions among the options, dependency versions (Nucleus Kit,
   * nucleus-dom), files app code reads, data a module fetches when it is
   * evaluated (only the first page that loads it records that). Change it
   * to render every page again.
   */
  key: string;
  /**
   * Reused pages rendered again each run, picked at random, and compared
   * with their cached copy: one that differs fails the run, since `key`
   * misses an input, and the cache is discarded. Text, attribute values,
   * elements and the island must match exactly; the order of attributes in
   * a tag need not, since work finishing in either order writes the same
   * element with its attributes in another order.
   * @default 2
   */
  verify?: number;
}

/** A page as cached: what was written, its diagnostics and the digest of its shell. */
export interface CachedPage {
  html: string;
  diagnostics: Diagnostics;
  shell: string;
}

const FILE = "pages.json";

/**
 * `cache.key`, the renderers' key (versions, data options, what `entry`
 * fetched while it loaded, a pool's `cacheKey()`) and the not-found route,
 * which the hooks of every page are told of. Each page's shell and requests
 * are checked apart. Data a module fetches when it is evaluated is recorded
 * only by the first page that loads it: cover it with `cache.key`.
 */
export const runKey = (
  cache: PrerenderCache,
  renderers: string,
  notFound?: string
): string => sha256(JSON.stringify([cache.key, renderers, notFound ?? null]));

const fileOf = ({ dir }: PrerenderCache) =>
  builtin("node:path").join(builtin("node:path").resolve(dir), FILE);

/** A cache as written: its key, its pages by URL, and the URLs that failed in that run. */
export interface StoredCache {
  key: string;
  pages: Record<string, CachedPage>;
  failed: string[];
}

/** The stored cache; none when it is missing or unreadable. */
export const readCache = (cache: PrerenderCache): StoredCache | undefined => {
  try {
    return JSON.parse(builtin("node:fs").readFileSync(fileOf(cache), "utf8"));
  } catch {
    return undefined;
  }
};

/** Why `stored` has no copy of `url` under `key` to check; none when it has one. */
export const missOf = (
  stored: StoredCache | undefined,
  key: string,
  url: string
): string | undefined =>
  !stored
    ? "no cache found"
    : stored.key !== key
      ? "the cache key changed"
      : stored.pages[url]
        ? undefined
        : stored.failed?.includes(url)
          ? "it failed in the last run"
          : "not in the cache";

/** Writes the cache aside, then moves it in place: never half a cache. */
export const writeCache = (
  cache: PrerenderCache,
  stored: StoredCache
): void => {
  const { mkdirSync, renameSync, writeFileSync } = builtin("node:fs");
  const file = fileOf(cache);
  // a name of its own: two runs may write at once
  const aside = `${file}.${builtin("node:crypto").randomUUID()}.tmp`;
  mkdirSync(builtin("node:path").dirname(file), { recursive: true });
  writeFileSync(aside, JSON.stringify(stored));
  renameSync(aside, file);
};

export const discardCache = (cache: PrerenderCache): void =>
  builtin("node:fs").rmSync(fileOf(cache), { force: true });

/** Up to `count` of `items`, picked at random. */
export const pick = <T>(items: readonly T[], count: number): Set<T> => {
  const left = [...items];
  return new Set(
    Array.from(
      { length: Math.max(0, Math.min(count, left.length)) },
      () => left.splice(Math.floor(Math.random() * left.length), 1)[0]!
    )
  );
};
