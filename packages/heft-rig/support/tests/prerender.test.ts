import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RIG_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(RIG_ROOT, "scripts/prerender.mjs");
// inside the repo: the runner finds rush.json and aliases the real workspace
const FIXTURE = path.join(__dirname, "fixtures/prerender");
const originalArgv = process.argv;
// a run starts a module runner here and one per worker: seconds each, more on a loaded machine
const SLOW = 60_000;

let out: string;
// a cache and a saved shell of their own per test: never the fixture's, which other runs of this suite share
let cacheDir: string;
let shellFile: string;

beforeEach(() => {
  out = mkdtempSync(path.join(os.tmpdir(), "rig-prerender-"));
  cacheDir = mkdtempSync(path.join(os.tmpdir(), "rig-prerender-cache-"));
  shellFile = path.join(cacheDir, "prerender-shell.html");
  process.env.RIG_PRERENDER_OUT = out;
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
  delete process.env.RIG_PRERENDER_OUT;
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

const load = async () => {
  process.argv = [process.execPath, "/elsewhere.mjs"];
  return import("../../scripts/prerender.mjs");
};

describe("createWorkspaceRunner", () => {
  it("loads workspace modules from source through the rig's aliases", async () => {
    const { createWorkspaceRunner } = await load();
    const runner = await createWorkspaceRunner(FIXTURE);
    try {
      const { SITE_BASE } = await runner.import("@excom/heft-rig/scripts/site-base.mjs");
      expect(SITE_BASE).toBe("/nucleus");
      const { options } = await runner.import(path.join(FIXTURE, "options.ts"));
      expect(options()).toMatchObject({ out, routes: ["/", "/nucleus/broken"] });
    } finally {
      await runner.close();
    }
  });
});

describe("workerKey", () => {
  it("covers the versions, the code of every module the runner evaluated and the site's own modules", async () => {
    const { createWorkspaceRunner } = await load();
    const { repositoryOf, workerKey } = await import("../../scripts/prerender-worker.mjs");
    const site = mkdtempSync(path.join(os.tmpdir(), "rig-prerender-site-"));
    mkdirSync(path.join(site, "assets"));
    writeFileSync(path.join(site, "index.html"), "<p>page</p>");
    writeFileSync(path.join(site, "assets/shell.js"), "export const a = 1;");
    const [one, two] = await Promise.all([createWorkspaceRunner(FIXTURE), createWorkspaceRunner(FIXTURE)]);
    try {
      await Promise.all([one, two].map((runner) => runner.import(path.join(FIXTURE, "options.ts"))));
      const repository = repositoryOf(FIXTURE);
      expect(repository).toBe(path.resolve(RIG_ROOT, "../.."));
      const key = await workerKey(one, site, repository);
      expect(await workerKey(two, pathToFileURL(site), repository)).toBe(key);
      expect(one.modules().map(({ id }) => id)).toContain(path.join(FIXTURE, "options.ts"));
      writeFileSync(path.join(site, "index.html"), "<p>no module</p>");
      expect(await workerKey(one, site, repository)).toBe(key);
      writeFileSync(path.join(site, "assets/shell.js"), "export const a = 2;");
      const changed = await workerKey(one, site, repository);
      expect(changed).not.toBe(key);
      await two.import(path.join(FIXTURE, "links.config.ts"));
      expect(await workerKey(two, site, repository)).not.toBe(changed);
    } finally {
      await Promise.all([one.close(), two.close()]);
      rmSync(site, { recursive: true, force: true });
    }
  });
});

describe("workerKey of another checkout", () => {
  it("gives the same key wherever the repository is", async () => {
    const { repositoryOf, workerKey } = await import("../../scripts/prerender-worker.mjs");
    const site = mkdtempSync(path.join(os.tmpdir(), "rig-prerender-site-"));
    const checkout = (repository: string) => ({
      import: async () => ({ default: { version: "1.0.0", dependencies: { "happy-dom": "20.8.3" } } }),
      modules: () => [
        { id: `${repository}/packages/site/entry.ts`, meta: { code: `import "${repository}/packages/kit/index.ts";` } },
        { id: "happy-dom", meta: { externalize: `file://${repository}/common/temp/node_modules/.pnpm/happy-dom@20.8.3/index.js` } },
      ],
    });
    try {
      const keys = await Promise.all(
        ["/work/a/nucleus", "/home/runner/nucleus"].map((repository) => workerKey(checkout(repository), site, repository)),
      );
      expect(keys[0]).toBe(keys[1]);
      expect(repositoryOf(site)).toBe(path.resolve(site));
    } finally {
      rmSync(site, { recursive: true, force: true });
    }
  });
});

describe("serveWorker", () => {
  it("loads the config through a runner of its own, and serves only in a pool's worker", async () => {
    const { serveWorker } = await import("../../scripts/prerender-worker.mjs");
    await expect(serveWorker({ packageRoot: FIXTURE, configFile: path.join(FIXTURE, "fail.config.ts") })).rejects.toThrow(
      "nucleus-ssr: serveRenderer() serves prerender()'s pool",
    );
  });
});

describe("parseArguments", () => {
  it("takes the config, the pool size and --no-cache", async () => {
    const { parseArguments } = await load();
    // no pool size: nucleus-ssr's default (one per core but one, at most 6)
    expect(parseArguments(["a.config.ts"])).toEqual({
      configFile: "a.config.ts",
      concurrency: undefined,
      cache: true,
    });
    expect(parseArguments(["--concurrency", "3", "a.config.ts", "--no-cache"])).toEqual({
      configFile: "a.config.ts",
      concurrency: 3,
      cache: false,
    });
    for (const value of ["0", "1.5", "many"])
      expect(() => parseArguments(["--concurrency", value, "a.config.ts"])).toThrow(
        `prerender: --concurrency takes a whole number above 0, not ${value}`,
      );
    // the rig saves the shell to SHELL_FILE
    expect(() => parseArguments(["a.config.ts", "--save-shell", "shell.html"])).toThrow("--save-shell");
  });
});

describe("runPrerender", { timeout: SLOW }, () => {
  const read = (file: string) => readFileSync(path.join(out, file), "utf8");

  it("exits 1 naming the route that failed, writing nothing", async () => {
    const { runPrerender } = await load();
    const log = vi.fn();
    const { exitCode, pages } = await runPrerender({
      packageRoot: FIXTURE,
      configFile: "fail.config.ts",
      log,
      cacheDir,
      shellFile,
    });
    expect(exitCode).toBe(1);
    expect(pages.map(({ url, status }) => [url, status])).toEqual([
      ["/", "ok"],
      ["/nucleus/broken", "failed"],
    ]);
    expect(existsSync(path.join(out, "index.html"))).toBe(false);
    const printed = log.mock.calls.map(([line]) => line).join("\n");
    expect(printed).toContain("broken on purpose");
    expect(printed).toContain("prerender: 1 rendered, 0 reused (0 verified), 0 shell route(s), 0 shell fallback(s), 1 failed");
    expect(printed).toContain("; nothing written");
  });

  it("writes every page and exits 0 when the config's onError sends the failing route to the shell", async () => {
    const { runPrerender } = await load();
    const log = vi.fn();
    const { exitCode, pages, links } = await runPrerender({
      packageRoot: FIXTURE,
      configFile: "shell.config.ts",
      log,
      cacheDir,
      shellFile,
    });
    expect(exitCode).toBe(0);
    expect(pages.map(({ status }) => status)).toEqual(["ok", "shell"]);
    expect(read("index.html")).toContain("<rig-greeting>Rendered by the entry</rig-greeting>");
    expect(read("nucleus/broken.html")).toBe(readFileSync(path.join(FIXTURE, "site/index.html"), "utf8"));
    // each page links /nucleus/broken; the config serves /sandbox/ elsewhere
    expect(links).toEqual({ checked: 2, broken: [] });
    expect(log).toHaveBeenCalledWith("  links: 2 checked, each to a page");
  });

  it("writes shell routes as the shell, counts them as pages in the link check, and saves the shell", async () => {
    const { runPrerender } = await load();
    const log = vi.fn();
    const { exitCode, pages, links } = await runPrerender({
      packageRoot: FIXTURE,
      configFile: "shell-routes.config.ts",
      log,
      cacheDir,
      shellFile,
    });
    const shell = readFileSync(path.join(FIXTURE, "site/index.html"), "utf8");
    expect(exitCode).toBe(0);
    expect(pages.map(({ url, status, shellRoute }) => [url, status, shellRoute])).toEqual([
      ["/", "ok", undefined],
      ["/nucleus/broken", "shell", true],
    ]);
    expect(read("nucleus/broken.html")).toBe(shell);
    // `/` links /nucleus/broken, a page now; the shell route's own markup is checked too
    expect(links).toEqual({ checked: 2, broken: [] });
    expect(readFileSync(shellFile, "utf8")).toBe(shell);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("prerender: 1 rendered, 0 reused (0 verified), 1 shell route(s), 0 shell fallback(s), 0 failed"));
  });

  it("saves no shell when the config's shell is a function: each route may have its own", async () => {
    const { runPrerender } = await load();
    await runPrerender({ packageRoot: FIXTURE, configFile: "shell-function.config.ts", log: vi.fn(), cacheDir, shellFile });
    expect(read("index.html")).toContain("<rig-greeting>Rendered by the entry</rig-greeting>");
    expect(existsSync(shellFile)).toBe(false);
  });

  it("exits 1 naming the page and its link when a written page links a page with no file", async () => {
    const { runPrerender } = await load();
    const log = vi.fn();
    const { exitCode, pages, links } = await runPrerender({
      packageRoot: FIXTURE,
      configFile: "links.config.ts",
      log,
      cacheDir,
      shellFile,
    });
    expect(exitCode).toBe(1);
    expect(pages.map(({ status }) => status)).toEqual(["ok"]);
    expect(links).toEqual({ checked: 1, broken: [{ page: "index.html", href: "/nucleus/broken#top" }] });
    expect(log.mock.calls.map(([line]) => line).slice(-2)).toEqual([
      "  links: 1 checked, 1 to no page:",
      "    index.html → /nucleus/broken#top",
    ]);
  });

  it(
    "reuses the pages of an earlier run from the package's cache, and checks the links of every written page",
    async () => {
      const { runPrerender } = await load();
      const cacheFile = path.join(cacheDir, "pages.json");
      const run = (cache?: boolean) =>
        runPrerender({ packageRoot: FIXTURE, configFile: "shell.config.ts", log: vi.fn(), concurrency: 2, cache, cacheDir, shellFile });
      expect((await run()).pages.map(({ reused }) => reused)).toEqual([false, false]);
      expect(existsSync(cacheFile)).toBe(true);
      const log = vi.fn();
      const { pages, links } = await runPrerender({
        packageRoot: FIXTURE,
        configFile: "shell.config.ts",
        log,
        concurrency: 2,
        cacheDir,
        shellFile,
      });
      // a shell fallback is never cached
      expect(pages.map(({ status, reused }) => [status, reused])).toEqual([
        ["ok", true],
        ["shell", false],
      ]);
      expect(read("index.html")).toContain("<rig-greeting>Rendered by the entry</rig-greeting>");
      expect(links).toEqual({ checked: 2, broken: [] });
      // the one reused page is also the one checked by rendering it again
      expect(log).toHaveBeenCalledWith(expect.stringContaining("prerender: 0 rendered, 1 reused (1 verified), 0 shell route(s), 1 shell fallback(s)"));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^ {2}shell {2}nucleus\/broken\.html .* \(cache: it failed in the last run\)$/));
      // --no-cache: neither read nor written
      rmSync(cacheFile);
      expect((await run(false)).pages.map(({ reused }) => reused)).toEqual([false, false]);
      expect(existsSync(cacheFile)).toBe(false);
    },
    120_000,
  );

  it("asks for a config module", async () => {
    const { runPrerender } = await load();
    await expect(runPrerender({ configFile: "" })).rejects.toThrow("prerender: pass the config module");
  });

  it("runs the config given on the command line when executed directly, setting the exit code", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(FIXTURE);
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = [process.execPath, SCRIPT, "fail.config.ts", "--no-cache"];
    vi.resetModules();
    const saved = path.join(FIXTURE, "temp/prerender-shell.html");
    try {
      await import("../../scripts/prerender.mjs");
      expect(process.exitCode).toBe(1);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
      // the shell the run rendered from, in the package: a failed run too
      expect(readFileSync(saved, "utf8")).toBe(readFileSync(path.join(FIXTURE, "site/index.html"), "utf8"));
    } finally {
      rmSync(path.join(FIXTURE, "temp"), { recursive: true, force: true });
    }
  });
});
