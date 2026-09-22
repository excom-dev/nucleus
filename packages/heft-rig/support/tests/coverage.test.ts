import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => ({ spawn: vi.fn() }));
// Node built-ins are interop'd through `default`, so mock both shapes.
vi.mock("node:child_process", async (importOriginal) => {
  const mocked = { ...(await importOriginal<object>()), spawn: spawnMock.spawn };
  return { ...mocked, default: mocked };
});

const RIG_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(RIG_ROOT, "scripts/coverage.mjs");
const VITEST_SCRIPT = path.join(RIG_ROOT, "scripts/vitest.mjs");
const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
  spawnMock.spawn.mockReset();
  spawnMock.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("exit", 0, null));
    return child;
  });
});

afterEach(() => {
  process.argv = originalArgv;
});

const load = () => import("../../scripts/coverage.mjs");

describe("coverage.mjs", () => {
  it("re-exports the lazy vitest config without running when imported", async () => {
    process.argv = [process.execPath, "/some/other/script.mjs"];
    const mod = await load();
    expect(typeof mod.default).toBe("function");
    const config = await mod.default();
    expect(config.test!.coverage!.provider).toBe("v8");
    expect(spawnMock.spawn).not.toHaveBeenCalled();
  });

  it("does not run without argv[1] or with an unresolvable argv[1]", async () => {
    process.argv = [process.execPath];
    await load();
    vi.resetModules();
    process.argv = [process.execPath, "missing-file.mjs"];
    await load();
    expect(spawnMock.spawn).not.toHaveBeenCalled();
  });

  it("runs vitest with --coverage when executed directly", async () => {
    process.argv = [process.execPath, SCRIPT, "support/tests/x.test.ts"];
    await load();
    expect(spawnMock.spawn).toHaveBeenCalledTimes(1);
    expect(spawnMock.spawn.mock.calls[0][1]).toEqual([
      "run",
      "--config",
      VITEST_SCRIPT,
      "--coverage",
      "support/tests/x.test.ts",
    ]);
  });
});
