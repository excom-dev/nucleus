import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

type LoadDependency = typeof import("../../load-dependency").loadDependency;

const win = window as unknown as Record<string, unknown>;

describe("loadDependency", () => {
  let loadDependency: LoadDependency;
  let appendChild: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    delete win.__DEPENDENCY_PROMISES__;
    ({ loadDependency } = await import("../../load-dependency"));
    /* Keep the `<script>` out of the document so happy-dom never
     * fetches `src`; tests drive `onload` / `onerror`. */
    appendChild = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation((node) => node);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete win.TestDep;
    delete win.__DEPENDENCY_PROMISES__;
  });

  const pendingScript = () =>
    appendChild.mock.calls[0][0] as unknown as HTMLScriptElement;

  it("initialises the shared promise registry once", async () => {
    expect(window.__DEPENDENCY_PROMISES__).toEqual({});
    const existing = { Preset: Promise.resolve("preset") };
    win.__DEPENDENCY_PROMISES__ = existing;
    vi.resetModules();
    await import("../../load-dependency");
    expect(window.__DEPENDENCY_PROMISES__).toBe(existing);
  });

  it("esm: returns the imported module", async () => {
    const mod = await loadDependency<{ default: number }>(
      "esm",
      "data:text/javascript,export default 42"
    );
    expect(mod.default).toBe(42);
    expect(appendChild).not.toHaveBeenCalled();
  });

  it("umd: returns an already-present global without a script", async () => {
    win.TestDep = { ready: true };
    await expect(loadDependency("umd", "/dep.js", "TestDep")).resolves.toEqual({
      ready: true,
    });
    expect(appendChild).not.toHaveBeenCalled();
  });

  it("umd: injects a script once and resolves with the global on load", async () => {
    const first = loadDependency("umd", "/vendor/dep.js", "TestDep");
    const second = loadDependency("umd", "/vendor/dep.js", "TestDep");
    expect(appendChild).toHaveBeenCalledTimes(1);
    const script = pendingScript();
    expect(script.tagName).toBe("SCRIPT");
    expect(script.src).toBe(`${window.location.origin}/vendor/dep.js`);
    expect(window.__DEPENDENCY_PROMISES__.TestDep).toBeInstanceOf(Promise);
    win.TestDep = { loaded: true };
    script.onload!(new Event("load"));
    await expect(first).resolves.toEqual({ loaded: true });
    await expect(second).resolves.toEqual({ loaded: true });
    // now that the global exists, later calls short-circuit
    await expect(
      loadDependency("umd", "/vendor/dep.js", "TestDep")
    ).resolves.toEqual({ loaded: true });
    expect(appendChild).toHaveBeenCalledTimes(1);
  });

  it("umd: rejects when the script fails to load", async () => {
    const pending = loadDependency("umd", "/vendor/missing.js", "TestDep");
    pendingScript().onerror!(new Event("error"));
    await expect(pending).rejects.toThrow("Failed to load dependency: TestDep");
  });

  it("rejects invalid requests", async () => {
    await expect(loadDependency("umd", "/dep.js")).rejects.toThrow(
      "Invalid dependency load request: umd | /dep.js | undefined"
    );
    await expect(
      loadDependency("cjs" as unknown as "umd", "/dep.js", "X")
    ).rejects.toThrow("Invalid dependency load request: cjs | /dep.js | X");
    expect(appendChild).not.toHaveBeenCalled();
  });
});
