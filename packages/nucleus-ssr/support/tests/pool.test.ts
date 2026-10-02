import { prerender, type PrerenderOptions, serveRenderer } from "../../index";
import { emptyDiagnostics } from "../../src/diagnostics";
import { STARTUP_MS } from "../../src/pool";
import { openRenderer, type RendererHandle } from "../../src/renderer";
import { perform } from "../../src/worker";
import type { TestWorker } from "./fixtures/pool/worker";
import { loadKit, ORIGIN, ownEntry, SITE } from "./helpers";
import { afterEach, describe, expect, it, vi } from "@excom/nucleus-test";
import childProcess, { type ChildProcess, type ForkOptions } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";
import timers from "node:timers";
import { fileURLToPath } from "node:url";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/pool");
const WORKER = join(FIXTURES, "worker.mjs");
const SILENT = join(FIXTURES, "silent.mjs");
const SITE_SHELL = readFileSync(join(SITE, "index.html"), "utf8");
const ROUTES = ["/", "/menu", "/specials/"];
// for a test that forks workers, and for the cleanup after it: each worker
// starts a module runner. On a loaded machine (sixteen busy processes on ten
// cores, memory swapping) a test took up to 60 s and removing its temporary
// directories up to 56 s; a CI runner is slower still
const SLOW = 120_000;

const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  delete process.env.NUCLEUS_SSR_TEST_WORKER;
}, SLOW);

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nucleus-ssr-pool-"));
  temporary.push(dir);
  return dir;
};

/** A copy of the fixture site to prerender in place. */
const copySite = () => {
  const dir = tempDir();
  cpSync(SITE, dir, { recursive: true });
  return dir;
};

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");

/** Every page under `dir`, by file. */
const pagesIn = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".html"))
      .sort()
      .map((file) => [file, read(dir, file)])
  );

/** The site's shell with `body` as its page. */
const page = (body: string) =>
  SITE_SHELL.replace(/<body>[\s\S]*<\/body>/, `<body>${body}</body>`);

/** `prerender()` in a pool of the test worker, set up as `worker` says. */
const pooled = (
  worker: TestWorker,
  options: Omit<Extract<PrerenderOptions, { worker: string | URL }>, "worker">
) => {
  process.env.NUCLEUS_SSR_TEST_WORKER = JSON.stringify(worker);
  return prerender({ ...options, worker: WORKER });
};

describe("prerender in a pool", () => {
  it(
    "writes what an in-process run writes, byte for byte, keeping the routes' order",
    async () => {
      const local = copySite();
      const options = { routes: ROUTES, notFound: "/no-such-page" };
      // as the worker settles: no 1 s cap of Quark's own, the budget bounds it
      const entry = async () => {
        const kit = await loadKit();
        const { Quark } = await import("@excom/quark");
        return { ...kit, settle: () => Quark.whenSettled({ timeout: Infinity }) };
      };
      await prerender({ ...options, root: local, out: local, origin: ORIGIN, entry, budgetMs: 30_000 });
      for (const concurrency of [1, 3]) {
        const site = copySite();
        const report = await pooled({ root: site }, { ...options, out: site, concurrency });
        expect(pagesIn(site)).toEqual(pagesIn(local));
        expect(report.pages.map(({ url, file, reused }) => [url, file, reused])).toEqual([
          ["/", "index.html", false],
          ["/menu", "menu.html", false],
          ["/specials/", "specials.html", false],
          ["/no-such-page", "404.html", false],
        ]);
        expect(report.pages[1]!.diagnostics.requests.map(({ url, status }) => [url, status])).toEqual([
          [`${ORIGIN}/site.css`, 200],
          [`${ORIGIN}/views/menu.html`, 200],
          [`${ORIGIN}/data/menu.json`, 200],
        ]);
        expect(report).toMatchObject({ failed: [], verified: [] });
      }
    },
    SLOW
  );

  it(
    "writes shell routes as the untouched shell, as an in-process run does, from any worker",
    async () => {
      const site = copySite();
      const out = tempDir();
      const report = await pooled(
        { root: site, bodies: { "/bag": "<p>Your bag</p>" } },
        { routes: ["/menu"], shellRoutes: ["/bag", "/account/orders/order"], out, concurrency: 2 }
      );
      expect(report.pages.map(({ url, file, shellRoute }) => [url, file, shellRoute])).toEqual([
        ["/menu", "menu.html", undefined],
        ["/bag", "bag.html", true],
        ["/account/orders/order", "account/orders/order.html", true],
      ]);
      expect(read(out, "bag.html")).toBe(page("<p>Your bag</p>"));
      expect(read(out, "account/orders/order.html")).toBe(SITE_SHELL);
      expect(read(out, "menu.html")).toContain('<html lang="en" n-ssr="">');
    },
    SLOW
  );

  it(
    "stops a page that never yields at twice its budget, and goes on with a new worker",
    async () => {
      const site = copySite();
      const out = tempDir();
      // the other pages static: done long before 10 s, however loaded the machine
      const report = await pooled(
        {
          root: site,
          budgetMs: 5000,
          bodies: { "/": "<p>Before</p>", "/hang": "<x-hang></x-hang>", "/after": "<p>After</p>" },
          shellOnError: ["/hang"],
        },
        { routes: ["/", "/hang", "/after"], out, concurrency: 1 }
      );
      expect(report.failed).toEqual(["/hang"]);
      expect(report.pages[1]!.diagnostics.errors).toEqual([
        "Not settled within budgetMs (5000 ms): the page never yielded, so its worker was stopped at 10000 ms",
      ]);
      expect(report.pages[1]!.ms).toBeGreaterThanOrEqual(10_000);
      // its policy is "shell": the untouched shell, from the new worker
      expect(read(out, "hang.html")).toBe(page("<x-hang></x-hang>"));
      expect(read(out, "after.html")).toContain("<p>After</p>");
    },
    SLOW
  );

  it(
    "fails the page of a worker that exits, replaces it, and writes nothing under fail",
    async () => {
      const site = copySite();
      await expect(
        pooled(
          { root: site, bodies: { "/crash": "<x-crash></x-crash>" } },
          { routes: ["/", "/crash", "/menu"], out: site, concurrency: 2 }
        )
      ).rejects.toMatchObject({
        message: "nucleus-ssr: 1 of 3 pages failed: /crash",
        report: {
          failed: ["/crash"],
          pages: [
            { url: "/", diagnostics: { errors: [] } },
            {
              url: "/crash",
              bytes: 0,
              diagnostics: { errors: ["The worker rendering this page exited (code 3)"] },
            },
            { url: "/menu", diagnostics: { errors: [] } },
          ],
        },
      });
      expect(read(site, "index.html")).toBe(SITE_SHELL);
      expect(existsSync(join(site, "menu.html"))).toBe(false);
    },
    SLOW
  );

  it(
    "writes nothing, whatever the policy, from a shell an earlier prerender wrote",
    async () => {
      const site = copySite();
      const stale =
        "nucleus-ssr: the shell was written by an earlier prerender (<html n-ssr>): rebuild the site, then prerender from its built shell";
      await expect(
        pooled({ root: site, stale: ["/menu"], shellOnError: ["/menu"] }, { routes: ["/", "/menu"], out: site })
      ).rejects.toThrow(stale);
      expect(read(site, "index.html")).toBe(SITE_SHELL);
      // the fixed shell: the worker cannot open its renderer
      writeFileSync(join(site, "index.html"), SITE_SHELL.replace("<html", "<html n-ssr"));
      await expect(
        pooled({ root: site, shellOnError: ["/"] }, { routes: ["/"], out: site, concurrency: 2 })
      ).rejects.toThrow(stale);
    },
    SLOW
  );

  it(
    "reuses every page of a second run, from workers whose keys agree",
    async () => {
      const site = copySite();
      const [first, second, cacheDir] = [tempDir(), tempDir(), tempDir()];
      const cache = { dir: cacheDir, key: "v1", verify: 1 };
      const options = { routes: ROUTES, cache, concurrency: 2 };
      const rendered = await pooled({ root: site, cacheKey: "app" }, { ...options, out: first });
      expect(rendered.pages.map(({ reused }) => reused)).toEqual([false, false, false]);
      const reused = await pooled({ root: site, cacheKey: "app" }, { ...options, out: second });
      expect(reused.pages.map(({ reused }) => reused)).toEqual([true, true, true]);
      expect(reused.verified).toHaveLength(1);
      expect(pagesIn(second)).toEqual(pagesIn(first));
      // another worker part of the key: nothing is reused
      const other = await pooled({ root: site, cacheKey: "app 2" }, { ...options, out: second });
      expect(other.pages.map(({ reused }) => reused)).toEqual([false, false, false]);
      // workers that disagree: the page ends the first, so its replacement
      // must report too (a pool whose other worker is still starting when
      // the work is done never hears from it)
      await expect(
        pooled(
          { root: site, cacheKey: "pid", bodies: { "/crash": "<x-crash></x-crash>" } },
          { routes: ["/crash"], out: second, concurrency: 1 }
        )
      ).rejects.toThrow(
        "nucleus-ssr: the workers report different cache keys: their cacheKey() must give each the same"
      );
    },
    SLOW
  );

  it(
    "takes a check whose worker exits for a change, and fails the page if rendering it exits too",
    async () => {
      const site = copySite();
      const options = { routes: ["/", "/menu"], cache: { dir: tempDir(), key: "v1", verify: 0 }, concurrency: 1 };
      await pooled({ root: site }, { ...options, out: tempDir() });
      await expect(
        pooled({ root: site, crashShell: ["/menu"] }, { ...options, out: tempDir() })
      ).rejects.toMatchObject({
        report: {
          pages: [
            { url: "/", reused: true },
            {
              url: "/menu",
              reused: false,
              cacheMiss: "its worker exited during the check (code 3)",
              diagnostics: { errors: ["The worker rendering this page exited (code 3)"] },
            },
          ],
        },
      });
    },
    SLOW
  );

  it("refuses routes that share a file and a concurrency below 1 before any worker starts", async () => {
    const out = tempDir();
    const worker = join(out, "never-started.mjs");
    await expect(prerender({ worker, out, routes: ["/menu", "/Menu"] })).rejects.toThrow(
      "nucleus-ssr: routes /menu and /Menu would both write Menu.html"
    );
    for (const concurrency of [0, 1.5])
      await expect(prerender({ worker, out, routes: ["/"], concurrency })).rejects.toThrow(
        `nucleus-ssr: concurrency must be a whole number above 0, not ${concurrency}`
      );
  });

  it(
    "fails the run, stopping its workers, when one serves no renderer in time",
    async () => {
      const delay = timers.setTimeout;
      // the limit, shortened: the worker never answers at all
      const spy = vi
        .spyOn(timers, "setTimeout")
        .mockImplementation(((callback: () => void, ms: number) =>
          delay(callback, ms === STARTUP_MS ? 200 : ms)) as typeof delay);
      try {
        await expect(
          prerender({ worker: SILENT, out: tempDir(), routes: ["/", "/menu"], concurrency: 2 })
        ).rejects.toThrow(`nucleus-ssr: worker ${SILENT} served no renderer within 300 s`);
      } finally {
        spy.mockRestore();
      }
    },
    SLOW
  );

  it(
    "stops the workers it started when starting another fails",
    async () => {
      const fork = childProcess.fork;
      let forks = 0;
      const spy = vi.spyOn(childProcess, "fork").mockImplementation(((
        path: string,
        args: string[],
        options: ForkOptions
      ) => {
        forks++;
        if (forks === 2) throw new Error("no process left");
        // the third never starts: it errs, and may never exit
        return fork(path, args, forks === 3 ? { ...options, execPath: join(tempDir(), "no-node") } : options);
      }) as typeof fork);
      try {
        await expect(pooled({ root: SITE }, { routes: ROUTES, out: tempDir(), concurrency: 2 })).rejects.toThrow(
          "no process left"
        );
        process.env.NUCLEUS_SSR_TEST_WORKER = JSON.stringify({ root: SITE });
        await expect(
          prerender({ worker: WORKER, routes: ROUTES, out: tempDir(), concurrency: 1 })
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        spy.mockRestore();
      }
    },
    SLOW
  );

  it(
    "fails the run when a worker exits before it serves a renderer",
    async () => {
      const out = tempDir();
      const worker = join(out, "missing.mjs");
      // the child inherits stderr: pipe it, to keep Node's stack out of the run's output
      const fork = childProcess.fork;
      let child!: ChildProcess;
      let stderr = "";
      const spy = vi.spyOn(childProcess, "fork").mockImplementation(((
        path: string,
        args: string[],
        options: ForkOptions
      ) => {
        child = fork(path, args, { ...options, silent: true });
        child.stderr!.on("data", (chunk) => (stderr += chunk));
        return child;
      }) as typeof fork);
      try {
        await expect(prerender({ worker, out, routes: ["/"] })).rejects.toThrow(
          `nucleus-ssr: worker ${worker} exited (code 1) before it served a renderer`
        );
        await finished(child.stderr!);
      } finally {
        spy.mockRestore();
      }
      expect(stderr).toMatch(/Cannot find module '.*missing\.mjs'/);
    },
    SLOW
  );
});

describe("a worker's renderer", () => {
  it("refuses to serve outside a pool's worker", async () => {
    await expect(serveRenderer({ root: SITE, origin: ORIGIN, entry: ownEntry() })).rejects.toThrow(
      "nucleus-ssr: serveRenderer() serves prerender()'s pool: run it in the module its worker option names"
    );
  });

  it("renders, checks, gives a lost page its policy and a shell route its shell; a shell error is fatal", { timeout: SLOW }, async () => {
    const renderer: RendererHandle = await openRenderer({
      root: SITE,
      origin: ORIGIN,
      shell: (url) => {
        if (url === "/gone") throw new Error("no shell");
        return url === "/stale" ? SITE_SHELL.replace("<html", "<html n-ssr") : page("<x-own></x-own>");
      },
      onError: (url) => (url === "/lost" ? "shell" : "fail"),
      entry: ownEntry(),
    });
    try {
      const rendered = await perform(renderer, { type: "render", url: "/" });
      expect(rendered).toMatchObject({ type: "page", outcome: { html: expect.stringContaining("<x-own>") } });
      const { outcome } = rendered as { outcome: { shell: string; diagnostics: { requests: [] } } };
      const inputs = { shell: outcome.shell, requests: outcome.diagnostics.requests };
      expect(await perform(renderer, { type: "check", url: "/", inputs })).toEqual({ type: "checked" });
      expect(await perform(renderer, { type: "check", url: "/gone", inputs })).toEqual({
        type: "checked",
        changed: "its shell function throws",
      });
      const diagnostics = { ...emptyDiagnostics(), errors: ["stopped"] };
      expect(await perform(renderer, { type: "lost", url: "/lost", diagnostics })).toEqual({
        type: "page",
        outcome: { html: page("<x-own></x-own>"), diagnostics },
      });
      for (const url of ["/menu", "/gone"])
        expect(await perform(renderer, { type: "lost", url, diagnostics })).toEqual({
          type: "page",
          outcome: { diagnostics },
        });
      expect(await perform(renderer, { type: "lost", url: "/stale", diagnostics })).toMatchObject({
        type: "fatal",
        error: { message: expect.stringContaining("written by an earlier prerender") },
      });
      // a shell route: its shell, whatever the policy; none from a function that throws
      expect(await perform(renderer, { type: "shell", url: "/menu" })).toEqual({
        type: "page",
        outcome: { html: page("<x-own></x-own>"), diagnostics: emptyDiagnostics() },
      });
      for (const url of ["/gone", "/lost"])
        expect(await perform(renderer, { type: "shell", url })).toEqual({
          type: "page",
          outcome: url === "/gone"
            ? { diagnostics: { ...emptyDiagnostics(), errors: ["shell: Error: no shell"] } }
            : { html: page("<x-own></x-own>"), diagnostics: emptyDiagnostics() },
        });
      expect(await perform(renderer, { type: "shell", url: "/stale" })).toMatchObject({
        type: "fatal",
        error: { message: expect.stringContaining("written by an earlier prerender") },
      });
    } finally {
      await renderer.close();
    }
  });
});
