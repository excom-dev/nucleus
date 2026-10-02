import type { IncomingMessage, ServerResponse } from "node:http";

/** How the host answers an unknown path, and spells a page's URL (`assets` in `wrangler.jsonc`). */
export interface HostSettings {
  not_found_handling: "none" | "404-page" | "single-page-application";
  html_handling: "auto-trailing-slash";
}

/** What the host answers a request with. */
export interface HostAnswer {
  status: number;
  /** The file it serves. */
  file?: string;
  /** Where a redirect or a move sends the request. */
  location?: string;
  /** Every header it sends, `[name, value]`, names lower-cased. */
  headers: [string, string][];
}

/** The `_redirects` and `_headers` of a build, matched against a request path. */
export interface HostRules {
  /** The matching `_redirects` line's target, its `:splat` and `:name` filled in. */
  redirect(pathname: string): { to: string; status: number } | undefined;
  /** Each matching `_headers` block: headers set, header names removed. */
  headers(pathname: string): { set: [string, string][]; unset: string[] }[];
}

/**
 * Serves the build in `root` as the host does, never cached, on every network
 * interface (`port` 0: any free port). `shell`: the file of the untouched shell
 * (`nucleus-ssr --save-shell <file>`), served in place of every prerendered page.
 */
export function serveSite(options: { root: string; port?: number; shell?: string }): Promise<{
  port: number;
  close(): void;
}>;

/** A Node request handler answering for the build in `root` as the host does; `shell` (bytes) in place of every prerendered page. */
export function hostHandler(
  root: string,
  options?: { shell?: Uint8Array },
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** What the host answers a request to the build in `root` with. */
export function answerOf(root: string, request?: { method?: string; url?: string }): Promise<HostAnswer>;

/** The `assets` settings the host serves the build in `root` with, from the nearest `wrangler.jsonc` / `wrangler.json`. */
export function hostOf(root: string): Promise<HostSettings>;

/** The rules of the build in `root`; none for a missing file. */
export function rulesOf(root: string, html?: HostSettings["html_handling"]): Promise<HostRules>;

/** The lines of a `_redirects` file the host keeps. */
export function redirectsOf(
  text: string,
  html?: HostSettings["html_handling"] | "none",
): { from: string; to: string; status: number }[];

/** The path blocks of a `_headers` file, as the host reads them. */
export function headersOf(text: string): { path: string; set: Record<string, string>; unset: string[] }[];
