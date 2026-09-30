import { resolveHref } from "@excom/kit-router";

/** Every `key=value` of `some` is also in `all`. */
const hasParams = (all: URLSearchParams, some: URLSearchParams) =>
  [...some].every(([key, value]) => all.getAll(key).includes(value));

/**
 * `url` has the path and query of `href`. `nested`: the path of `href` or a
 * child of it, and at least the query of `href`.
 */
export const urlMatchesHref = (
  url: string,
  href: string,
  {
    ignoreHash = false,
    nested = false,
  }: { ignoreHash?: boolean; nested?: boolean } = {}
) => {
  if (url === href) {
    return true;
  }
  const { pathname, searchParams, hash } = new URL(url, location.origin);
  const target = new URL(resolveHref(href), location.origin);
  const base = target.pathname.replace(/\/$/, "");
  return (
    (nested
      ? pathname === base || pathname.startsWith(`${base}/`)
      : pathname === target.pathname &&
        searchParams.size === target.searchParams.size) &&
    hasParams(searchParams, target.searchParams) &&
    (ignoreHash || hash === target.hash)
  );
};
