/**
 * Nucleus Kit's server entry as the whole `entry`: its elements and its
 * hooks, with no entry module of the app's own.
 */
import { prerender } from "../../index";
import { ORIGIN, parse, SITE } from "./helpers";
import { afterEach, describe, expect, it, vi } from "@excom/nucleus-test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/** A copy of the fixture site to prerender in place. */
const copySite = () => {
  const dir = mkdtempSync(join(tmpdir(), "nucleus-ssr-kit-"));
  temporary.push(dir);
  cpSync(SITE, dir, { recursive: true });
  return dir;
};

/** The options of a kit app's config: the entry is the kit's, in a fresh module graph per renderer. */
const options = (root: string) => ({
  root,
  origin: ORIGIN,
  // generous: only a page that never settles fails on a loaded machine
  budgetMs: 30_000,
  entry: async () => {
    vi.resetModules();
    return import("@excom/nucleus-kit/server");
  },
});

const page = (root: string, file: string) => parse(readFileSync(join(root, file), "utf8"));

/** The errors of each failed page of a run that rejects, by URL. */
const failuresOf = async (run: Promise<unknown>) => {
  const { report } = await run.then(
    () => ({ report: { pages: [] } }),
    (error) => error as { report: { pages: { url: string; diagnostics: { errors: string[] } }[] } }
  );
  return Object.fromEntries(
    report.pages.filter(({ diagnostics }) => diagnostics.errors.length).map(({ url, diagnostics }) => [url, diagnostics.errors])
  );
};

describe("prerender with Nucleus Kit's server entry and no other", { timeout: 120_000 }, () => {
  it("renders the routes and the not-found page into root", async () => {
    const site = copySite();
    const report = await prerender({ ...options(site), routes: ["/", "/menu"], notFound: "/no-such-page" });
    expect(report.failed).toEqual([]);
    expect(page(site, "index.html").querySelector("spa-route[is-active] > h1")!.textContent).toBe("Welcome to Wren Café");
    // the router went back to a cold load of each page, and each waited for its sheets and its data
    expect(page(site, "menu.html").title).toBe("Menu");
    expect(page(site, "menu.html").querySelectorAll("spa-route[is-active]")).toHaveLength(1);
    expect(page(site, "404.html").querySelector("spa-route[is-fallback][is-active] > h1")!.textContent).toBe("Not found");
  });

  it("fails a route only the fallback route matches, a soft 404, and writes nothing", async () => {
    const site = copySite();
    expect(await failuresOf(prerender({ ...options(site), routes: ["/menu", "/gone"], notFound: "/no-such-page" }))).toEqual({
      "/gone": ["Error: /gone matches no route"],
    });
    expect(existsSync(join(site, "menu.html"))).toBe(false);
  });

  it("fails a not-found page a route matches", async () => {
    expect(await failuresOf(prerender({ ...options(copySite()), routes: ["/"], notFound: "/menu" }))).toEqual({
      "/menu": ["Error: /menu is not the fallback route: the not-found page needs a <spa-route is-fallback> that matches it"],
    });
  });
});
