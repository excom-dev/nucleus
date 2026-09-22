import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => {
  const spawn = vi.fn();
  return { spawn };
});

// Node built-ins are interop'd through `default`, so mock both shapes.
vi.mock("node:child_process", async (importOriginal) => {
  const mocked = { ...(await importOriginal<object>()), spawn: spawnMock.spawn };
  return { ...mocked, default: mocked };
});

const RIG_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(RIG_ROOT, "scripts/vitest.mjs");
const VITEST_BIN = path.join(RIG_ROOT, "node_modules/.bin/vitest");

/** A fake child that exits (or errors) on the next tick. */
const fakeChild = (code: number | null, signal: string | null = null, error?: Error) => {
  const child = new EventEmitter();
  setImmediate(() => {
    if (error) child.emit("error", error);
    else child.emit("exit", code, signal);
  });
  return child;
};

const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
  spawnMock.spawn.mockReset();
  spawnMock.spawn.mockImplementation(() => fakeChild(0));
});

afterEach(() => {
  process.argv = originalArgv;
});

const load = () => import("../../scripts/vitest.mjs");

describe("vitest.mjs", () => {
  it("exports the shared test config as a lazy function and does not spawn when imported", async () => {
    process.argv = [process.execPath, "/some/other/script.mjs"];
    const mod = await load();
    // Importing must stay cheap for the CLI wrapper: the config is built only
    // when Vite calls the exported function.
    expect(typeof mod.default).toBe("function");
    const config = await mod.default();
    expect(config.root).toBe(process.cwd());
    expect(config.test!.environment).toBe("happy-dom");
    expect(spawnMock.spawn).not.toHaveBeenCalled();
  });

  it("does not spawn without an argv[1] or when argv[1] cannot be resolved", async () => {
    process.argv = [process.execPath];
    await load();
    vi.resetModules();
    process.argv = [process.execPath, "does-not-exist.mjs"];
    await load();
    expect(spawnMock.spawn).not.toHaveBeenCalled();
  });

  it("runs vitest when executed directly", async () => {
    process.argv = [process.execPath, path.relative(process.cwd(), SCRIPT), "support/tests/x.test.ts"];
    await load();
    expect(spawnMock.spawn).toHaveBeenCalledTimes(1);
    expect(spawnMock.spawn).toHaveBeenCalledWith(
      VITEST_BIN,
      ["run", "--config", SCRIPT, "support/tests/x.test.ts"],
      { stdio: "inherit" },
    );
  });

  describe("runVitest", () => {
    it("omits `run` in watch mode and forwards extra args first", async () => {
      process.argv = [process.execPath, "/elsewhere.mjs"];
      const { runVitest } = await load();
      await runVitest({ extraArgs: ["--coverage"], argv: ["-w", "a.test.ts"] });
      expect(spawnMock.spawn.mock.calls[0][1]).toEqual(["--config", SCRIPT, "--coverage", "-w", "a.test.ts"]);
      await runVitest({ argv: ["--watch"] });
      expect(spawnMock.spawn.mock.calls[1][1]).toEqual(["--config", SCRIPT, "--watch"]);
    });

    it("defaults argv to the process arguments", async () => {
      process.argv = [process.execPath, "/elsewhere.mjs", "--reporter", "dot"];
      const { runVitest } = await load();
      await runVitest();
      expect(spawnMock.spawn.mock.calls[0][1]).toEqual(["run", "--config", SCRIPT, "--reporter", "dot"]);
    });

    it("rejects on a non-zero exit code, signal or spawn error", async () => {
      process.argv = [process.execPath, "/elsewhere.mjs"];
      const { runVitest } = await load();
      spawnMock.spawn.mockImplementationOnce(() => fakeChild(1));
      await expect(runVitest({ argv: [] })).rejects.toThrow("vitest exited with code 1");
      spawnMock.spawn.mockImplementationOnce(() => fakeChild(null, "SIGTERM"));
      await expect(runVitest({ argv: [] })).rejects.toThrow("vitest exited with code null (signal: SIGTERM)");
      spawnMock.spawn.mockImplementationOnce(() => fakeChild(0, null, new Error("ENOENT")));
      await expect(runVitest({ argv: [] })).rejects.toThrow("ENOENT");
    });
  });
});
