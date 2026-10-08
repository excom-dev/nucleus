import { main, serveWorker } from "../../cli";
import { checkLinks, defineConfig, runPrerender, sitemapRoutes } from "../../index";
import { parseArguments } from "../../src/cli";
import { forkWorker } from "../../src/node";
import {
  classifyPages,
  CONFIG_ENV,
  defaultConcurrency,
  formatLinks,
  formatReport,
  liveMarkup,
  loadPrerenderConfig,
} from "../../src/run";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "@excom/nucleus-test";
import childProcess, { type ForkOptions, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// node:path, not `new URL()`: the test environment's `URL` is happy-dom's
const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = join(PACKAGE, "support/tests/fixtures/run");
// the command's worker mode from source: the built one needs `dist`
const WORKER = join(FIXTURES, "worker.mjs");
const SHELL = readFileSync(join(FIXTURES, "site/index.html"), "utf8");
// each run forks workers, each starting a module runner (see pool.test.ts)
const SLOW = 120_000;

const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  delete process.env.NUCLEUS_SSR_TEST_OUT;
  delete process.env.NUCLEUS_SSR_TEST_OTHER_OUT;
  delete process.env.NUCLEUS_SSR_TEST_CACHE;
  delete process.env.NUCLEUS_SSR_TEST_RELATIVE;
  delete process.env[CONFIG_ENV];
  vi.restoreAllMocks();
}, SLOW);

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nucleus-ssr-run-"));
  temporary.push(dir);
  return dir;
};

const RELATIVE = join(FIXTURES, "relative");

/** A fresh temporary folder for `relative/prerender.config.js`, given to it relative to its own folder. */
const relativeOutput = () => {
  const dir = tempDir();
  process.env.NUCLEUS_SSR_TEST_RELATIVE = relative(RELATIVE, dir);
  return dir;
};

/** A fresh output directory for the fixture configs. */
const output = () => (process.env.NUCLEUS_SSR_TEST_OUT = tempDir());

/** The lines a run printed. */
const printed = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(([line]) => line as string);

const diagnostics = (overrides = {}) => ({
  errors: [],
  warnings: [],
  requests: [],
  skippedProvisions: [],
  neutralizedScripts: 0,
  heldTimers: [],
  islandBytes: 0,
  ...overrides,
});

describe("runPrerender", () => {
  it(
    "loads a config in plain JavaScript with the default loader, and exits 1 naming the route that failed, writing nothing",
    async () => {
      const out = output();
      const shellFile = join(tempDir(), "saved/shell.html");
      const log = vi.fn();
      const { exitCode, pages, links } = await runPrerender({
        config: "fail.config.js",
        cwd: FIXTURES,
        worker: WORKER,
        concurrency: 1,
        shellFile,
        log,
      });
      expect(exitCode).toBe(1);
      expect(pages.map(({ url, status }) => [url, status])).toEqual([
        ["/", "ok"],
        ["/broken", "failed"],
      ]);
      expect(links).toBeUndefined();
      expect(existsSync(join(out, "index.html"))).toBe(false);
      const lines = printed(log).join("\n");
      expect(lines).toContain("broken on purpose");
      expect(lines).toContain("prerender: 1 rendered, 0 reused (0 verified), 0 shell route(s), 0 shell fallback(s), 1 failed");
      expect(lines).toContain("; nothing written");
      // the shell the run rendered from: a failed run too
      expect(readFileSync(shellFile, "utf8")).toBe(SHELL);
      // each worker gets the config in its own environment, never this process's
      expect(process.env[CONFIG_ENV]).toBeUndefined();
    },
    SLOW
  );

  it(
    "loads a config in TypeScript with the default loader, writes shell routes and shell fallbacks, checks the links and forks the command by default",
    async () => {
      const out = output();
      const fork = childProcess.fork;
      const forked: string[] = [];
      vi.spyOn(childProcess, "fork").mockImplementation(((path: string, args: string[], options: ForkOptions) => {
        forked.push(path);
        return fork(WORKER, args, options);
      }) as typeof fork);
      const log = vi.fn();
      const { exitCode, pages, links } = await runPrerender({
        config: join(FIXTURES, "site.config.ts"),
        concurrency: 1,
        log,
      });
      expect(forked).toEqual([join(PACKAGE, "nucleus-ssr.mjs")]);
      expect(exitCode).toBe(0);
      expect(pages.map(({ url, status, shellRoute }) => [url, status, shellRoute])).toEqual([
        ["/", "ok", undefined],
        ["/broken", "shell", undefined],
        ["/bag", "shell", true],
      ]);
      expect(readFileSync(join(out, "index.html"), "utf8")).toContain(
        "<run-greeting>Rendered by the entry</run-greeting>"
      );
      expect(readFileSync(join(out, "broken.html"), "utf8")).toBe(SHELL);
      expect(readFileSync(join(out, "bag.html"), "utf8")).toBe(SHELL);
      // each page links /broken and /bag; the config serves /sandbox/ elsewhere
      expect(links).toEqual({ checked: 6, broken: [] });
      expect(printed(log)).toContain("  links: 6 checked, each to a page");
      expect(printed(log)).toContainEqual(
        expect.stringContaining("prerender: 1 rendered, 0 reused (0 verified), 1 shell route(s), 1 shell fallback(s), 0 failed")
      );
    },
    SLOW
  );

  it(
    "exits 1 naming the page and its link when a written page links a page with no file; a shell function saves no shell",
    async () => {
      output();
      const shellFile = join(tempDir(), "shell.html");
      const log = vi.fn();
      const { exitCode, pages, links } = await runPrerender({
        config: join(FIXTURES, "links.config.js"),
        worker: pathToFileURL(WORKER),
        concurrency: 1,
        shellFile,
        log,
      });
      expect(exitCode).toBe(1);
      expect(pages.map(({ status }) => status)).toEqual(["ok"]);
      expect(links).toEqual({
        checked: 2,
        broken: [
          { page: "index.html", href: "/broken#top" },
          { page: "index.html", href: "/bag" },
        ],
      });
      expect(printed(log).slice(-3)).toEqual([
        "  links: 2 checked, 2 to no page:",
        "    index.html → /broken#top",
        "    index.html → /bag",
      ]);
      // each route may have its own: said, not saved
      expect(existsSync(shellFile)).toBe(false);
      expect(printed(log)[0]).toBe(
        "prerender: no shell saved: the config's shell is a function, each route may have its own"
      );
    },
    SLOW
  );

  it(
    "uses the config's cache, one passed in its place, or none (false)",
    async () => {
      output();
      const own = (process.env.NUCLEUS_SSR_TEST_CACHE = tempDir());
      const ownFile = join(own, "pages.json");
      const run = (cache?: false | { dir: string; key: string }) =>
        runPrerender({
          config: join(FIXTURES, "cache.config.js"),
          worker: WORKER,
          concurrency: 1,
          cache,
          log: vi.fn(),
        });
      const first = await run();
      expect(first.pages[0]).toMatchObject({ url: "/", reused: false, cacheMiss: "no cache found" });
      const written = statSync(ownFile).mtimeMs;
      // neither read nor written
      const dropped = await run(false);
      expect(dropped.pages[0]).toMatchObject({ reused: false });
      expect(dropped.pages[0]!.cacheMiss).toBeUndefined();
      expect(statSync(ownFile).mtimeMs).toBe(written);
      const again = await run();
      expect(again.pages[0]).toMatchObject({ reused: true, verified: true });
      const other = tempDir();
      const passed = await run({ dir: other, key: "another" });
      expect(passed.pages[0]).toMatchObject({ reused: false, cacheMiss: "no cache found" });
      expect(existsSync(join(other, "pages.json"))).toBe(true);
    },
    SLOW
  );

  it(
    "renders two runs at once in one process, each with its own config",
    async () => {
      const one = output();
      const two = (process.env.NUCLEUS_SSR_TEST_OTHER_OUT = tempDir());
      const run = (config: string) =>
        runPrerender({ config: join(FIXTURES, config), worker: WORKER, concurrency: 2, log: vi.fn() });
      const runs = await Promise.all([run("site.config.ts"), run("other.config.js")]);
      expect(runs.map(({ exitCode }) => exitCode)).toEqual([0, 0]);
      expect(readFileSync(join(one, "index.html"), "utf8")).toContain(
        "<run-greeting>Rendered by the entry</run-greeting>"
      );
      expect(readFileSync(join(two, "index.html"), "utf8")).toContain(
        "<run-greeting>Rendered by the other entry</run-greeting>"
      );
      expect(readFileSync(join(one, "index.html"), "utf8")).not.toContain("other entry");
    },
    SLOW
  );

  it(
    "resolves the config's relative paths against its folder, whatever the working directory",
    async () => {
      const dir = relativeOutput();
      expect(process.cwd()).not.toBe(RELATIVE);
      const shellFile = join(tempDir(), "shell.html");
      const { exitCode } = await runPrerender({
        config: "prerender.config.js",
        cwd: RELATIVE,
        worker: WORKER,
        concurrency: 1,
        shellFile,
        log: vi.fn(),
      });
      expect(exitCode).toBe(0);
      expect(readFileSync(join(dir, "out/index.html"), "utf8")).toContain("Rendered by the entry");
      expect(existsSync(join(dir, "cache/pages.json"))).toBe(true);
      expect(readFileSync(shellFile, "utf8")).toBe(SHELL);
      // no shell where root points: said with the path, before any worker starts
      const fork = vi.spyOn(childProcess, "fork");
      await expect(runPrerender({ config: join(RELATIVE, "missing.config.js"), worker: WORKER })).rejects.toThrow(
        `prerender: no shell at ${join(RELATIVE, "nowhere/index.html")}: build the site first, or fix root in ${join(RELATIVE, "missing.config.js")}`
      );
      expect(fork).not.toHaveBeenCalled();
    },
    SLOW
  );

  it("asks for a config module", async () => {
    await expect(runPrerender({ config: "" })).rejects.toThrow(
      "prerender: pass the config module, e.g. prerender.config.js"
    );
  });
});

describe("main", () => {
  it(
    "runs the config given with each flag, resolving to the exit code",
    async () => {
      const out = output();
      const cacheDir = (process.env.NUCLEUS_SSR_TEST_CACHE = tempDir());
      const shellFile = join(tempDir(), "shell.html");
      const fork = vi.spyOn(childProcess, "fork");
      vi.spyOn(console, "log").mockImplementation(() => {});
      // the config's path relative to the working directory, as typed
      const config = relative(process.cwd(), join(FIXTURES, "cache.config.js"));
      expect(
        await main([config, "--concurrency", "2", "--no-cache", "--save-shell", shellFile], { worker: WORKER })
      ).toBe(0);
      expect(fork).toHaveBeenCalledTimes(2);
      // the config names a cache: dropped
      expect(readdirSync(cacheDir)).toEqual([]);
      expect(readFileSync(shellFile, "utf8")).toBe(SHELL);
      expect(existsSync(join(out, "index.html"))).toBe(true);
      expect(console.log).toHaveBeenCalledWith("  links: 6 checked, each to a page");
      // a failed page
      expect(await main([join(FIXTURES, "fail.config.js"), "--concurrency", "1"], { worker: WORKER })).toBe(1);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
    },
    SLOW
  );

  it(
    "runs a config of relative paths from another working directory",
    async () => {
      const dir = relativeOutput();
      vi.spyOn(console, "log").mockImplementation(() => {});
      const config = relative(process.cwd(), join(RELATIVE, "prerender.config.js"));
      expect(dirname(config)).not.toBe(".");
      expect(await main([config, "--concurrency", "1", "--no-cache"], { worker: WORKER })).toBe(0);
      expect(readFileSync(join(dir, "out/index.html"), "utf8")).toContain("Rendered by the entry");
      expect(existsSync(join(dir, "cache"))).toBe(false);
    },
    SLOW
  );

  it("prints a mistake in one line, with the usage line for one in the arguments, and resolves to 1", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const usage = "Usage: nucleus-ssr <config> [--concurrency <n>] [--no-cache] [--save-shell <file>]";
    const refusal = async (args: string[]) => {
      errors.mockClear();
      expect(await main(args, { worker: WORKER })).toBe(1);
      expect(errors).toHaveBeenCalledTimes(1);
      return errors.mock.calls[0]![0] as string;
    };
    expect(await refusal([])).toBe(`nucleus-ssr: no config module given\n${usage}`);
    expect(await refusal(["a.config.js", "--watch"])).toBe(`nucleus-ssr: Unknown option '--watch'\n${usage}`);
    expect(await refusal(["a.config.js", "--concurrency"])).toBe(
      `nucleus-ssr: Option '--concurrency <value>' argument missing\n${usage}`
    );
    expect(await refusal(["a.config.js", "--concurrency", "0"])).toBe(
      `nucleus-ssr: --concurrency takes a whole number above 0, not 0\n${usage}`
    );
    expect(await refusal(["a.config.js", "b.config.js"])).toBe(
      `nucleus-ssr: one config only, not a.config.js b.config.js\n${usage}`
    );
    expect(await refusal([join(FIXTURES, "no.config.js")])).toBe(
      `nucleus-ssr: no config at ${join(FIXTURES, "no.config.js")}\n${usage}`
    );
    // the config's own mistakes: no usage line
    expect(await refusal([join(RELATIVE, "missing.config.js")])).toBe(
      `prerender: no shell at ${join(RELATIVE, "nowhere/index.html")}: build the site first, or fix root in ${join(RELATIVE, "missing.config.js")}`
    );
    expect(await refusal([join(FIXTURES, "routeless.config.js")])).toBe(
      `prerender: ${join(FIXTURES, "routeless.config.js")} exports no options with routes`
    );
  });

  it("prints the usage for --help and -h, and resolves to 0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--help"])).toBe(0);
    expect(await main(["a.config.js", "-h"])).toBe(0);
    expect(log).toHaveBeenCalledTimes(2);
    const help = log.mock.calls[0]![0] as string;
    expect(help.split("\n")[0]).toBe(
      "Usage: nucleus-ssr <config> [--concurrency <n>] [--no-cache] [--save-shell <file>]"
    );
    for (const flag of ["--concurrency <n>", "--no-cache", "--save-shell <file>", "-h, --help"]) expect(help).toContain(flag);
  });

  it("lets an error in the config's own code throw, stack and all", async () => {
    await expect(main([join(FIXTURES, "throws.config.js")])).rejects.toThrow("the config threw on purpose");
  });
});

describe("serveWorker", () => {
  it("loads the run's config and serves only in a pool's worker", async () => {
    process.env[CONFIG_ENV] = join(FIXTURES, "fail.config.js");
    await expect(serveWorker()).rejects.toThrow("nucleus-ssr: serveRenderer() serves prerender()'s pool");
  });
});

describe("nucleus-ssr.mjs", () => {
  const WRAPPER = join(PACKAGE, "nucleus-ssr.mjs");
  // in Node, `dist/cli.js` resolving to a stand-in that prints its calls
  const HOOKS = pathToFileURL(join(FIXTURES, "stub-hooks.mjs")).href;
  const run = (env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", HOOKS, WRAPPER, "a.config.js", "--no-cache"], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });

  it("runs the built command with its arguments and exits with its code, whatever the environment says", () => {
    const command = ['["main",["a.config.js","--no-cache"]]\n', "", 1];
    const outcome = ({ stdout, stderr, status }: ReturnType<typeof run>) => [stdout, stderr, status];
    expect(outcome(run())).toEqual(command);
    // a config variable exported in the shell, or the marker alone without a parent: no worker
    expect(outcome(run({ [CONFIG_ENV]: "/site/prerender.config.js" }))).toEqual(command);
    expect(outcome(run({ NUCLEUS_SSR_WORKER: "1" }))).toEqual(command);
  });

  // in this process, where coverage sees it: the built `dist/cli.js` mocked, and `process` as a child's or not
  describe("in this process", () => {
    const originalSend = Object.getOwnPropertyDescriptor(process, "send");
    const originalArgv = process.argv;
    const originalCode = process.exitCode;

    // the wrapper's import must resolve before the mock can answer it: a fresh checkout has no build
    const BUILT = join(PACKAGE, "dist/cli.js");
    const stubbed = !existsSync(BUILT);
    beforeAll(() => {
      if (!stubbed) return;
      mkdirSync(dirname(BUILT), { recursive: true });
      writeFileSync(BUILT, "export const main = async () => 1;\nexport const serveWorker = async () => {};\n");
    });
    afterAll(() => {
      if (stubbed) rmSync(join(PACKAGE, "dist"), { recursive: true, force: true });
    });

    afterEach(() => {
      process.argv = originalArgv;
      process.exitCode = originalCode;
      if (originalSend) Object.defineProperty(process, "send", originalSend);
      else delete (process as unknown as Record<string | symbol, unknown>).send;
      delete process.env.NUCLEUS_SSR_WORKER;
      vi.doUnmock("../../dist/cli.js");
      vi.resetModules();
    });

    const load = async (asWorker: boolean) => {
      const cli = { main: vi.fn(async () => 3), serveWorker: vi.fn(async () => {}) };
      vi.resetModules();
      vi.doMock("../../dist/cli.js", () => cli);
      process.argv = [process.execPath, WRAPPER, "a.config.js", "--no-cache"];
      // a channel either way: only the marker, which the run's fork sets, tells a worker
      Object.defineProperty(process, "send", { configurable: true, writable: true, value: () => true });
      if (asWorker) process.env.NUCLEUS_SSR_WORKER = "1";
      await import("../../nucleus-ssr.mjs");
      return cli;
    };

    it("runs the command with its arguments and takes its code as the exit code, channel or not, without the marker", async () => {
      const cli = await load(false);
      expect(cli.main).toHaveBeenCalledWith(["a.config.js", "--no-cache"]);
      expect(cli.serveWorker).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(3);
    });

    it("serves a worker, and runs no command, when an IPC channel and the marker say its run forked it", async () => {
      process.exitCode = undefined;
      const cli = await load(true);
      expect(cli.serveWorker).toHaveBeenCalledTimes(1);
      expect(cli.main).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });
  });

  it(
    "serves a worker when its run forked it, with the config of that run",
    async () => {
      // as the pool forks it: an IPC channel, the marker, the run's config
      const child = forkWorker(WRAPPER, { [CONFIG_ENV]: "/site/prerender.config.js", NODE_OPTIONS: `--import=${HOOKS}` });
      try {
        const message = await new Promise((resolve) => child.on("message", resolve));
        expect(message).toEqual(["serveWorker", "/site/prerender.config.js"]);
      } finally {
        child.kill("SIGKILL");
      }
    },
    SLOW
  );
});

describe("parseArguments", () => {
  it("takes the config, the pool size, --no-cache, --save-shell and --help", () => {
    expect(parseArguments(["a.config.js"])).toEqual({
      config: "a.config.js",
      concurrency: undefined,
      cache: undefined,
      shellFile: undefined,
    });
    expect(
      parseArguments(["--concurrency", "3", "a.config.js", "--no-cache", "--save-shell", "temp/shell.html"])
    ).toEqual({ config: "a.config.js", concurrency: 3, cache: false, shellFile: "temp/shell.html" });
    for (const value of ["0", "1.5", "many"])
      expect(() => parseArguments(["--concurrency", value, "a.config.js"])).toThrow(
        `nucleus-ssr: --concurrency takes a whole number above 0, not ${value}`
      );
    expect(parseArguments(["-h"])).toBe("help");
  });
});

describe("defaultConcurrency", () => {
  it("is one worker per core but one, at most 6", () => {
    expect(defaultConcurrency()).toBe(Math.max(1, Math.min(availableParallelism() - 1, 6)));
  });
});

describe("sitemapRoutes", () => {
  const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://wren.test/</loc></url>
  <url><loc>https://wren.test/menu</loc></url>
  <url><loc>https://wren.test/menu/a&amp;b</loc></url>
</urlset>
`;

  it("takes each URL as a path on the origin", () => {
    expect(sitemapRoutes(SITEMAP, "https://wren.test")).toEqual(["/", "/menu", "/menu/a&b"]);
  });

  it("refuses an empty sitemap and URLs off the site", () => {
    expect(() => sitemapRoutes("<urlset></urlset>", "https://wren.test")).toThrow(
      "prerender: the sitemap lists no URL"
    );
    expect(() => sitemapRoutes("<url><loc>https://elsewhere.test/x</loc></url>", "https://wren.test")).toThrow(
      "prerender: https://elsewhere.test/x is not on https://wren.test"
    );
    // another host that starts the same
    expect(() => sitemapRoutes(SITEMAP, "https://wren.tes")).toThrow(
      "prerender: https://wren.test/ is not on https://wren.tes"
    );
  });

  it("refuses a sitemap index: it lists sitemaps, not pages", () => {
    for (const index of [
      "<sitemapindex><sitemap><loc>https://wren.test/sitemap-1.xml</loc></sitemap></sitemapindex>",
      "<s:sitemapindex xmlns:s='http://www.sitemaps.org/schemas/sitemap/0.9'><s:sitemap><s:loc>https://wren.test/a.xml</s:loc></s:sitemap></s:sitemapindex>",
    ])
      expect(() => sitemapRoutes(index, "https://wren.test")).toThrow(
        "prerender: the sitemap is a sitemap index: it lists sitemaps, not pages; pass one of its sitemaps"
      );
  });

  it("reads whitespace, CDATA, entities and a namespace prefix; the bare origin is /; each path once, queries kept", () => {
    const urls = (locs: string[], prefix = "") =>
      `<${prefix}urlset>${locs.map((loc) => `<${prefix}url><${prefix}loc>${loc}</${prefix}loc></${prefix}url>`).join("")}</${prefix}urlset>`;
    expect(
      sitemapRoutes(
        urls([
          "https://wren.test",
          "\n  https://wren.test/a\n",
          "<![CDATA[ https://wren.test/b?x=1&y=2 ]]>",
          "https://wren.test/it&apos;s",
          "https://wren.test/a&#38;b&#x26;c",
          "https://wren.test/a",
          "https://wren.test/caf%C3%A9",
        ]),
        "https://wren.test"
      )
    ).toEqual(["/", "/a", "/b?x=1&y=2", "/it's", "/a&b&c", "/caf%C3%A9"]);
    // an origin written with a trailing slash
    expect(sitemapRoutes(urls(["https://wren.test/a"]), "https://wren.test/")).toEqual(["/a"]);
    // the sitemap's own prefix; an extension's `<image:loc>` is no page
    expect(
      sitemapRoutes(
        urls(["https://wren.test/a</s:loc><image:image><image:loc>https://cdn.test/x.png</image:loc></image:image><s:loc>https://wren.test/b"], "s:"),
        "https://wren.test"
      )
    ).toEqual(["/a", "/b"]);
    expect(
      sitemapRoutes(
        "<urlset><url><loc>https://wren.test/a</loc><image:image><image:loc>https://cdn.test/x.png</image:loc></image:image></url></urlset>",
        "https://wren.test"
      )
    ).toEqual(["/a"]);
  });
});

describe("loadPrerenderConfig", () => {
  const load = (config: unknown) => async () => ({ default: config });

  it("takes the default export, or what a default-exported function returns", async () => {
    expect(await loadPrerenderConfig("a.ts", load({ routes: ["/"] }))).toEqual({ routes: ["/"] });
    expect(await loadPrerenderConfig("b.ts", load(async () => ({ routes: [] })))).toEqual({
      routes: [],
    });
  });

  it("resolves relative root, out and cache.dir against the config's folder; out is root when it names none", async () => {
    const folder = join(tmpdir(), "site");
    const file = join(folder, "prerender.config.ts");
    expect(await loadPrerenderConfig(file, load({ root: "dist", routes: ["/"] }))).toEqual({
      root: join(folder, "dist"),
      out: join(folder, "dist"),
      routes: ["/"],
    });
    expect(
      await loadPrerenderConfig(
        file,
        load({ root: "../dist", out: "public", cache: { dir: "temp", key: "k" }, routes: ["/"] })
      )
    ).toEqual({
      root: join(tmpdir(), "dist"),
      out: join(folder, "public"),
      cache: { dir: join(folder, "temp"), key: "k" },
      routes: ["/"],
    });
    const root = new URL("file:///srv/dist/");
    expect(await loadPrerenderConfig(file, load({ root, routes: ["/"] }))).toMatchObject({ root, out: root });
  });

  it("defineConfig returns the options, or the function returning them, as given", async () => {
    const options = { root: "dist", origin: "https://wren.test", entry: async () => ({}), routes: ["/"] };
    expect(defineConfig(options)).toBe(options);
    const later = async (routes = ["/"]) => ({ ...options, routes });
    expect(defineConfig(later)).toBe(later);
    // a function keeps its own parameters
    expect((await defineConfig(later)(["/menu"])).routes).toEqual(["/menu"]);
    expect(await loadPrerenderConfig(join(tmpdir(), "c.ts"), load(defineConfig(() => options)))).toMatchObject({
      routes: ["/"],
    });
  });

  it("refuses a config without routes", async () => {
    await expect(loadPrerenderConfig("c.ts", load({ root: "dist" }))).rejects.toThrow(
      "prerender: c.ts exports no options with routes"
    );
    await expect(loadPrerenderConfig("d.ts", load(undefined))).rejects.toThrow("d.ts");
  });
});

describe("classifyPages", () => {
  it("marks failures by the onError policy and routes whose file is missing", () => {
    const written = tempDir();
    ["index.html", "a.html", "b.html"].forEach((file) => writeFileSync(join(written, file), ""));
    const page = (url: string, file: string, errors: string[] = []) => ({
      url,
      file,
      bytes: 1,
      ms: 1,
      diagnostics: diagnostics({ errors }),
    });
    const report = {
      pages: [
        page("/", "index.html"),
        page("/a", "a.html", ["boom"]),
        page("/b", "b.html", ["bang"]),
        page("/gone", "gone.html"),
      ],
      failed: ["/a", "/b"],
    } as never;
    const statuses = (onError?: unknown) =>
      classifyPages(report, { out: written, onError } as never).map(({ status, problems }) => [status, problems]);
    expect(statuses()).toEqual([
      ["ok", []],
      ["failed", ["boom"]],
      ["failed", ["bang"]],
      ["failed", ["no file at gone.html"]],
    ]);
    expect(statuses((url: string) => (url === "/a" ? "shell" : "fail"))).toEqual([
      ["ok", []],
      ["shell", ["boom"]],
      ["failed", ["bang"]],
      ["failed", ["no file at gone.html"]],
    ]);
    expect(statuses("shell").map(([status]) => status)).toEqual(["ok", "shell", "shell", "failed"]);
    // a shell route is the shell; one that failed has none to fall back to
    const shellRoutes = {
      pages: [{ ...page("/", "index.html"), shellRoute: true }, { ...page("/a", "a.html", ["no shell"]), shellRoute: true }],
      failed: ["/a"],
    } as never;
    expect(classifyPages(shellRoutes, { out: written, onError: "shell" }).map(({ status }) => status)).toEqual([
      "shell",
      "failed",
    ]);
    expect(
      classifyPages({ ...(report as object), verified: ["/"] } as never, { out: written }).map(({ verified }) => verified)
    ).toEqual([true, false, false, false]);
    // nothing was written: no file is missing
    expect(classifyPages(report, { out: written }, false).map(({ status }) => status)).toEqual([
      "ok",
      "failed",
      "failed",
      "ok",
    ]);
  });
});

describe("formatReport", () => {
  it("prints a line per page, problems under failures, then counts, sizes and warnings", () => {
    const lines = formatReport(
      [
        {
          url: "/",
          file: "index.html",
          bytes: 12_345,
          ms: 40,
          status: "ok",
          problems: [],
          diagnostics: diagnostics({ islandBytes: 2_000, warnings: ["slow"] }),
        },
        {
          url: "/docs/a",
          file: "docs/a.html",
          bytes: 3_000,
          ms: 7,
          status: "shell",
          problems: ["Refused DELETE"],
          diagnostics: diagnostics({ errors: ["Refused DELETE"], warnings: ["slow"] }),
        },
        {
          url: "/x",
          file: "x.html",
          bytes: 0,
          ms: 5_001,
          status: "failed",
          problems: ["Not settled"],
          diagnostics: diagnostics({ errors: ["Not settled"] }),
        },
        {
          url: "/b",
          file: "b.html",
          bytes: 1_000,
          ms: 2,
          status: "ok",
          problems: [],
          diagnostics: diagnostics(),
          reused: true,
        },
        {
          url: "/c",
          file: "c.html",
          bytes: 1_000,
          ms: 30,
          status: "ok",
          problems: [],
          diagnostics: diagnostics(),
          reused: true,
          verified: true,
        },
        {
          url: "/d",
          file: "d.html",
          bytes: 1_000,
          ms: 30,
          status: "ok",
          problems: [],
          diagnostics: diagnostics(),
          reused: false,
          cacheMiss: "the shell changed",
        },
        {
          url: "/bag",
          file: "bag.html",
          bytes: 900,
          ms: 1,
          status: "shell",
          problems: [],
          diagnostics: diagnostics(),
          reused: false,
          shellRoute: true,
        },
      ] as never,
      61_250
    );
    expect(lines).toEqual([
      "  ok     index.html    12.3 kB    40 ms island 2.0 kB 1 warning(s)",
      "  shell  docs/a.html    3.0 kB     7 ms 1 warning(s)",
      "           Refused DELETE",
      "  failed x.html              -  5001 ms",
      "           Not settled",
      "  ok     b.html         1.0 kB     2 ms reused",
      "  ok     c.html         1.0 kB    30 ms verified",
      "  ok     d.html         1.0 kB    30 ms (cache: the shell changed)",
      "  shell  bag.html       0.9 kB     1 ms",
      "prerender: 2 rendered, 2 reused (1 verified), 1 shell route(s), 1 shell fallback(s), 1 failed, in 61.3 s",
      "  largest pages: index.html 12.3 kB, docs/a.html 3.0 kB, b.html 1.0 kB",
      "  largest islands: index.html 2.0 kB",
      "  warning ×2: slow",
    ]);
  });
});

describe("liveMarkup", () => {
  it("drops comments, scripts, styles and inert template content, keeping declarative shadow roots", () => {
    expect(
      liveMarkup(
        [
          "<p>a</p><!-- <p>comment</p> -->",
          '<script type="application/json">{"html":"<template>"}</script>',
          "<STYLE>p > a {}</STYLE>",
          '<template data-note="a > b"><p>inert</p><template><p>nested</p></template><p>inert</p></template>',
          "<p>b</p>",
          '<template shadowrootmode="open"><p>shadow</p><template><p>inert</p></template><p>shadow</p></template>',
          "<p>c</p><template><p>unclosed",
        ].join("")
      )
    ).toBe("<p>a</p><p>b</p><p>shadow</p><p>shadow</p><p>c</p>");
  });
});

describe("checkLinks", () => {
  const PAGE = [
    '<html><head><link rel="alternate" href="/missing-link-element"></head><body>',
    '<spa-a route-href="/a/b">a page</spa-a>',
    '<spa-a route-href="/a/b/">trailing slash</spa-a>',
    '<spa-a route-href="/docs">folder index</spa-a>',
    '<spa-a route-href="/">home</spa-a>',
    '<a href="b">relative, to /a/b</a>',
    '<a href="#top">fragment</a>',
    '<a href="?page=2">query</a>',
    '<a href="/a/b?x=1&amp;y=2#z">query and fragment</a>',
    '<a href="/caf%C3%A9">encoded</a>',
    '<a href="/missing">missing</a>',
    "<a href='/missing-single'>single quotes</a>",
    "<a href=/missing-bare>no quotes</a>",
    '<a title="x > y" href="/missing-after-gt">> in a value</a>',
    '<a href="/missing">the same link again</a>',
    '<a class="a" data-href="/data" href="/missing-&#x41;&amp;b">entities</a>',
    '<a href="/llms.txt">a file</a>',
    '<a href="/sandbox/app">served elsewhere</a>',
    '<a href="https://elsewhere.test/missing">another site</a>',
    '<a href="mailto:someone@example.com">mail</a>',
    '<a href="http://[broken">unparsable</a>',
    '<a name="anchor">no href</a>',
    '<a-b href="/missing-custom">custom element</a-b>',
    '<abbr href="/missing-abbr">abbreviation</abbr>',
    '<spa-route route-href="/missing-route/:pattern"></spa-route>',
    '<template><a href="/missing-template">inert</a></template>',
    '<template shadowrootmode="open"><a href="/missing-shadow">live</a></template>',
    '<!-- <a href="/missing-comment"> -->',
    '<script type="application/json">{"html":"<a href=\\"/missing-script\\">"}</script>',
    "</body></html>",
  ].join("\n");

  it("lists each link of a written page to no page of the site, once per page", () => {
    const out = tempDir();
    for (const file of ["index.html", "a/b.html", "a/x.html", "docs/index.html", "café.html"]) {
      mkdirSync(dirname(join(out, file)), { recursive: true });
      writeFileSync(join(out, file), file === "a/x.html" ? PAGE : "<p>page</p>");
    }
    const pages = [
      { url: "/a/x", file: "a/x.html" },
      { url: "/gone", file: "gone.html" },
    ];
    const servedElsewhere = (url: string) => new URL(url).pathname.startsWith("/sandbox/");
    const missing = [
      "/missing",
      "/missing-single",
      "/missing-bare",
      "/missing-after-gt",
      "/missing-&#x41;&amp;b",
      "/missing-shadow",
    ].map((href) => ({ page: "a/x.html", href: href.replace("&#x41;&amp;", "A&") }));
    expect(checkLinks(pages, { out, origin: "https://wren.test/base", servedElsewhere })).toEqual({
      checked: 16,
      broken: missing,
    });
    // without the predicate, the sandbox link leads to no page either
    expect(checkLinks(pages, { out: pathToFileURL(out), origin: "https://wren.test" })).toEqual({
      checked: 17,
      broken: [...missing.slice(0, 5), { page: "a/x.html", href: "/sandbox/app" }, missing[5]],
    });
  });

  it("checks a path that does not decode as it is written", () => {
    const out = tempDir();
    writeFileSync(join(out, "index.html"), '<a href="/caf%E9">latin-1</a><a href="/100%25">a percent</a>');
    writeFileSync(join(out, "caf%E9.html"), "<p>page</p>");
    expect(checkLinks([{ url: "/", file: "index.html" }], { out, origin: "https://wren.test" })).toEqual({
      checked: 2,
      broken: [{ page: "index.html", href: "/100%25" }],
    });
  });
});

describe("formatLinks", () => {
  it("prints the count, then each link to no page with its page", () => {
    expect(formatLinks({ checked: 12, broken: [] })).toEqual(["  links: 12 checked, each to a page"]);
    expect(
      formatLinks({
        checked: 12,
        broken: [
          { page: "index.html", href: "/gone" },
          { page: "docs/a.html", href: "../gone#top" },
        ],
      })
    ).toEqual(["  links: 12 checked, 2 to no page:", "    index.html → /gone", "    docs/a.html → ../gone#top"]);
  });
});
