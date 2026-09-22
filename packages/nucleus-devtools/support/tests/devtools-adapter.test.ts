/**
 * The real extension-API adapter, driven by a scripted `chrome` global, the
 * seam the fake adapter in the other tests bypasses.
 */
import {
  createBrowserAdapter,
  resolveExtensionApi,
  type BrowserLike,
} from "../../lib/devtools-adapter";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const g = globalThis as Record<string, unknown>;

const makeChrome = () => {
  const evalCalls: string[] = [];
  const runtimeListeners = new Set<(m: unknown) => void>();
  const selectionListeners = new Set<() => void>();
  const ports: Array<{
    name: string;
    posted: unknown[];
    messageListeners: Array<(m: unknown) => void>;
    disconnectListeners: Array<() => void>;
  }> = [];
  let evalResult: [unknown, unknown] = [{ ok: true }, undefined];
  const chrome: BrowserLike = {
    devtools: {
      inspectedWindow: {
        eval: (expression, cb) => {
          evalCalls.push(expression);
          cb(...evalResult);
        },
      },
      panels: {
        elements: {
          onSelectionChanged: {
            addListener: (cb) => selectionListeners.add(cb),
            removeListener: (cb) => selectionListeners.delete(cb),
          },
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (cb) => runtimeListeners.add(cb),
        removeListener: (cb) => runtimeListeners.delete(cb),
      },
      connect: ({ name }) => {
        const entry = {
          name,
          posted: [] as unknown[],
          messageListeners: [] as Array<(m: unknown) => void>,
          disconnectListeners: [] as Array<() => void>,
        };
        ports.push(entry);
        return {
          postMessage: (m) => entry.posted.push(m),
          onMessage: { addListener: (cb) => entry.messageListeners.push(cb) },
          onDisconnect: { addListener: (cb) => entry.disconnectListeners.push(cb) },
        };
      },
    },
  };
  return {
    chrome,
    evalCalls,
    runtimeListeners,
    selectionListeners,
    ports,
    setEval: (result: unknown, exception?: unknown) => {
      evalResult = [result, exception];
    },
  };
};

describe("devtools adapter", () => {
  afterEach(() => {
    delete g.chrome;
    delete g.browser;
  });

  it("resolves `chrome` when no `browser` global exists (Chrome pages)", () => {
    const { chrome } = makeChrome();
    g.chrome = chrome;
    expect(resolveExtensionApi()).toBe(chrome);
  });

  it("prefers a real `browser` global and ignores a bare stub", () => {
    const { chrome } = makeChrome();
    const browser = makeChrome().chrome;
    g.chrome = chrome;
    g.browser = browser;
    expect(resolveExtensionApi()).toBe(browser);
    g.browser = {};
    expect(resolveExtensionApi()).toBe(chrome);
  });

  it("throws a clear error outside an extension page", () => {
    expect(() => resolveExtensionApi()).toThrow(/extension API unavailable/);
  });

  it("wires eval, listeners and ports through the API object", async () => {
    const fake = makeChrome();
    g.chrome = fake.chrome;
    const adapter = createBrowserAdapter();

    await expect(adapter.evalInPage("1 + 1")).resolves.toEqual({ ok: true });
    expect(fake.evalCalls).toEqual(["1 + 1"]);
    fake.setEval(undefined, { isError: true });
    await expect(adapter.evalInPage("boom")).resolves.toBeNull();
    fake.setEval(undefined, undefined);
    await expect(adapter.evalInPage("void 0")).resolves.toBeNull();

    const onMessage = () => {};
    const disposeMessage = adapter.onRuntimeMessage(onMessage);
    expect(fake.runtimeListeners.has(onMessage)).toBe(true);
    disposeMessage();
    expect(fake.runtimeListeners.has(onMessage)).toBe(false);

    const onSelection = () => {};
    const disposeSelection = adapter.onSelectionChanged(onSelection);
    expect(fake.selectionListeners.has(onSelection)).toBe(true);
    disposeSelection();
    expect(fake.selectionListeners.has(onSelection)).toBe(false);

    const port = adapter.connectPort("nucleus-devtools");
    port.postMessage({ type: "ready" });
    expect(fake.ports).toMatchObject([
      { name: "nucleus-devtools", posted: [{ type: "ready" }] },
    ]);
  });

  it("forwards port message / disconnect listeners to the underlying port", () => {
    const fake = makeChrome();
    g.chrome = fake.chrome;
    const port = createBrowserAdapter().connectPort("nucleus-devtools");

    const received: unknown[] = [];
    let disconnected = 0;
    port.onMessage((m) => received.push(m));
    port.onDisconnect(() => disconnected++);

    const [entry] = fake.ports;
    entry.messageListeners.forEach((cb) => cb({ type: "publicize" }));
    entry.disconnectListeners.forEach((cb) => cb());
    expect(received).toEqual([{ type: "publicize" }]);
    expect(disconnected).toBe(1);
  });
});
