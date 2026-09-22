import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type WatchCb = (eventType: string, filename: string | null) => void;
const mocks = vi.hoisted(() => ({
  runFullBuild: vi.fn(),
  watch: vi.fn(),
  watchers: [] as { dir: string; opts: object; cb: WatchCb; emitter: EventEmitter }[],
}));

// Node built-ins are interop'd through `default`, so mock both shapes.
vi.mock("node:fs", async (importOriginal) => {
  const mocked = { ...(await importOriginal<object>()), watch: mocks.watch };
  return { ...mocked, default: mocked };
});
vi.mock("../../scripts/vite-build.mjs", () => ({ runFullBuild: mocks.runFullBuild }));

let root: string;
let withSrc: string;
let withoutSrc: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-watch-"));
  withSrc = path.join(root, "with-src");
  withoutSrc = path.join(root, "without-src");
  await mkdir(path.join(withSrc, "src"), { recursive: true });
  await mkdir(withoutSrc, { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
  mocks.watchers.length = 0;
  mocks.runFullBuild.mockReset().mockResolvedValue(undefined);
  mocks.watch.mockReset().mockImplementation((dir: string, opts: object, cb: WatchCb) => {
    const emitter = new EventEmitter();
    mocks.watchers.push({ dir, opts, cb, emitter });
    return emitter;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const start = (cwd: string) => {
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  return import("../../scripts/vite-build-watch.mjs");
};

describe("vite-build-watch.mjs", () => {
  it("builds once, then watches the root and src/ non-recursively", async () => {
    await start(withSrc);
    expect(mocks.runFullBuild).toHaveBeenCalledTimes(1);
    expect(mocks.runFullBuild).toHaveBeenCalledWith(withSrc);
    expect(mocks.watchers.map((w) => [w.dir, w.opts])).toEqual([
      [withSrc, { recursive: false }],
      [path.join(withSrc, "src"), { recursive: false }],
    ]);
    expect(console.log).toHaveBeenCalledWith("[vite-build-watch] Initial build complete. Watching...");
  });

  it("only watches the root when there is no src/", async () => {
    await start(withoutSrc);
    expect(mocks.watchers.map((w) => w.dir)).toEqual([withoutSrc]);
  });

  it("debounces relevant changes into one full build and reports failures", async () => {
    await start(withoutSrc);
    vi.useFakeTimers();
    const [{ cb }] = mocks.watchers;

    // Irrelevant files never schedule a build.
    for (const name of [
      null,
      "",
      "node_modules/x/index.ts",
      "types.d.ts",
      "a.test.ts",
      "a.spec.ts",
      "a.test.css",
      "a.spec.css",
      "README.md",
    ]) {
      cb("change", name);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.runFullBuild).toHaveBeenCalledTimes(1);

    // Two quick relevant changes collapse into a single build.
    cb("change", "index.ts");
    cb("rename", "index.css");
    await vi.advanceTimersByTimeAsync(299);
    expect(mocks.runFullBuild).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.runFullBuild).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith("[vite-build-watch] Build complete.");

    mocks.runFullBuild.mockRejectedValueOnce(new Error("compile error"));
    cb("change", "src/x.ts");
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.runFullBuild).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith("[vite-build-watch] Build failed:", expect.any(Error));
  });

  it("logs watcher errors and hints at ulimit for EMFILE", async () => {
    await start(withoutSrc);
    const [{ emitter }] = mocks.watchers;
    emitter.emit("error", Object.assign(new Error("too many files"), { code: "EMFILE" }));
    expect(console.error).toHaveBeenCalledWith("[vite-build-watch] Watcher error:", "too many files");
    expect(console.error).toHaveBeenCalledWith(
      "[vite-build-watch] Try: ulimit -n 10240 (or run without recursive watch)",
    );
    (console.error as ReturnType<typeof vi.fn>).mockClear();
    emitter.emit("error", Object.assign(new Error("gone"), { code: "ENOENT" }));
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
