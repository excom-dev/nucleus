/**
 * The WXT entrypoints, loaded with the extension globals WXT normally
 * auto-imports (`defineContentScript`, `defineBackground`, `browser`)
 * replaced by scriptable stand-ins. Each entry's `main()` is driven directly.
 */
import { HEATMAP_ATTR } from "../../lib/heatmap";
import {
  ATTACH_EVENT,
  HEATMAP_STORAGE_KEY,
  HOOK_KEY,
  MESSAGE_SOURCE,
  PAGE_API_KEY,
  PORT_NAME,
} from "../../lib/protocol";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const g = globalThis as Record<string, unknown>;

type ContentScript = {
  matches: string[];
  runAt: string;
  world: string;
  main: () => void;
};

type Background = { main: () => void };

const flush = async () => {
  for (let i = 0; i < 3; i++) await wait(0);
};

beforeAll(() => {
  // WXT's `defineContentScript` / `defineBackground` return their argument.
  g.defineContentScript = (definition: ContentScript) => definition;
  g.defineBackground = (main: () => void) => ({ main });
});

afterEach(() => {
  delete g.browser;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* --- background.ts --- */

const makePort = (name: string) => {
  const messageListeners: Array<(m: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: unknown[] = [];
  return {
    name,
    posted,
    postMessage: vi.fn((message: unknown) => {
      posted.push(message);
    }),
    onMessage: { addListener: (cb: (m: unknown) => void) => messageListeners.push(cb) },
    onDisconnect: { addListener: (cb: () => void) => disconnectListeners.push(cb) },
    ping: () => messageListeners.forEach((cb) => cb({ type: "ready" })),
    disconnect: () => disconnectListeners.forEach((cb) => cb()),
  };
};

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown;

const makeSessionStorage = (initial: Record<string, unknown> = {}) => {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(store, values);
    }),
  };
};

const makeBackgroundBrowser = (
  registered: Array<{ id: string }> = [],
  tabs: Array<{ id?: number }> = [],
) => {
  const connectListeners: Array<(port: unknown) => void> = [];
  const messageListeners: MessageListener[] = [];
  const getRegisteredContentScripts = vi.fn(async () => registered);
  const registerContentScripts = vi.fn(async (scripts: Array<{ id: string }>) => {
    registered.push(...scripts);
  });
  const session = makeSessionStorage();
  const sendMessage = vi.fn(async (_tabId: number, _message: unknown) => undefined);
  const browser = {
    runtime: {
      onConnect: { addListener: (cb: (port: unknown) => void) => connectListeners.push(cb) },
      onMessage: { addListener: (cb: MessageListener) => messageListeners.push(cb) },
    },
    scripting: { getRegisteredContentScripts, registerContentScripts },
    storage: { session },
    tabs: { query: vi.fn(async () => tabs), sendMessage },
  };
  return {
    browser,
    registered,
    session,
    tabsSendMessage: sendMessage,
    getRegisteredContentScripts,
    registerContentScripts,
    connect: (port: ReturnType<typeof makePort>) => connectListeners.forEach((cb) => cb(port)),
    message: (message: unknown, sendResponse: (response: unknown) => void = () => {}) =>
      messageListeners.map((cb) => cb(message, {}, sendResponse)),
  };
};

const publicize = (seq: number) => ({
  source: MESSAGE_SOURCE,
  type: "publicize",
  record: { seq, path: ["neutron", "effect"], elementId: "1", tag: "x-el", at: 0, meta: {} },
});

describe("entrypoints/background", () => {
  let background: Background;

  beforeAll(async () => {
    background = (await import("../../entrypoints/background")).default as unknown as Background;
  });

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("registers the dev content scripts that are missing, once", async () => {
    const fake = makeBackgroundBrowser([{ id: "wxt:content-scripts/bridge.js" }]);
    g.browser = fake.browser;
    background.main();
    await flush();
    expect(fake.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(fake.registerContentScripts.mock.calls[0][0]).toEqual([
      {
        id: "wxt:content-scripts/page-hook.js",
        js: ["content-scripts/page-hook.js"],
        matches: ["<all_urls>"],
        runAt: "document_start",
        world: "MAIN",
      },
    ]);
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining("registered dev content scripts (wxt:content-scripts/page-hook.js)"),
    );

    // a second start finds everything registered
    background.main();
    await flush();
    expect(fake.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(fake.getRegisteredContentScripts).toHaveBeenCalledTimes(2);
  });

  it("warns instead of throwing when the scripting API fails", async () => {
    const fake = makeBackgroundBrowser();
    fake.getRegisteredContentScripts.mockRejectedValueOnce(new Error("no permission"));
    g.browser = fake.browser;
    background.main();
    await flush();
    expect(fake.registerContentScripts).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not register dev content scripts"),
      expect.any(Error),
    );
  });

  it("skips self-registration in production builds", async () => {
    vi.stubEnv("DEV", false);
    const fake = makeBackgroundBrowser();
    g.browser = fake.browser;
    background.main();
    await flush();
    expect(fake.getRegisteredContentScripts).not.toHaveBeenCalled();
  });

  it("relays publications to every connected pane port and drops dead ones", async () => {
    const fake = makeBackgroundBrowser([
      { id: "wxt:content-scripts/page-hook.js" },
      { id: "wxt:content-scripts/bridge.js" },
    ]);
    g.browser = fake.browser;
    background.main();
    await flush();

    const stranger = makePort("someone-else");
    const paneA = makePort(PORT_NAME);
    const paneB = makePort(PORT_NAME);
    fake.connect(stranger);
    fake.connect(paneA);
    fake.connect(paneB);
    paneA.ping(); // keepalive is a no-op

    fake.message({ source: "other-extension", type: "publicize" });
    fake.message({ source: MESSAGE_SOURCE, type: "ready" });
    fake.message(null);
    expect(paneA.posted).toEqual([]);

    fake.message(publicize(1));
    expect(paneA.posted).toEqual([publicize(1)]);
    expect(paneB.posted).toEqual([publicize(1)]);
    expect(stranger.posted).toEqual([]);

    // a port whose postMessage throws is forgotten
    paneB.postMessage.mockImplementationOnce(() => {
      throw new Error("Attempting to use a disconnected port object");
    });
    fake.message(publicize(2));
    expect(paneA.posted).toHaveLength(2);
    expect(paneB.posted).toHaveLength(1);
    fake.message(publicize(3));
    expect(paneB.postMessage).toHaveBeenCalledTimes(2);

    // a disconnected port stops receiving
    paneA.disconnect();
    fake.message(publicize(4));
    expect(paneA.posted).toHaveLength(3);
  });
});

describe("entrypoints/background heatmap", () => {
  let background: Background;

  beforeAll(async () => {
    background = (await import("../../entrypoints/background")).default as unknown as Background;
  });

  beforeEach(() => {
    vi.stubEnv("DEV", false);
  });

  it("stores the toggle and relays it to every tab, ignoring tabs without a bridge", async () => {
    const fake = makeBackgroundBrowser([], [{ id: 1 }, { id: 2 }, {}]);
    fake.tabsSendMessage.mockImplementation(async (tabId: number) => {
      if (tabId === 2) throw new Error("Could not establish connection");
    });
    g.browser = fake.browser;
    background.main();
    fake.message({ source: MESSAGE_SOURCE, type: "heatmap", enabled: true });
    await flush();
    expect(fake.session.store[HEATMAP_STORAGE_KEY]).toBe(true);
    const relayed = { source: MESSAGE_SOURCE, type: "heatmap", enabled: true };
    expect(fake.tabsSendMessage.mock.calls).toEqual([
      [1, relayed],
      [2, relayed],
    ]);

    fake.message({ source: MESSAGE_SOURCE, type: "heatmap", enabled: "yes" });
    await flush();
    expect(fake.session.store[HEATMAP_STORAGE_KEY]).toBe(false);
    expect(fake.tabsSendMessage).toHaveBeenLastCalledWith(2, { ...relayed, enabled: false });
  });

  it("answers heatmap-state queries from the stored value (default off)", async () => {
    const fake = makeBackgroundBrowser();
    g.browser = fake.browser;
    background.main();
    const reply = vi.fn();
    const [keepAlive] = fake.message({ source: MESSAGE_SOURCE, type: "heatmap-state" }, reply);
    expect(keepAlive).toBe(true);
    await flush();
    expect(reply).toHaveBeenCalledWith({ enabled: false });

    fake.session.store[HEATMAP_STORAGE_KEY] = true;
    const reply2 = vi.fn();
    fake.message({ source: MESSAGE_SOURCE, type: "heatmap-state" }, reply2);
    await flush();
    expect(reply2).toHaveBeenCalledWith({ enabled: true });
  });

  it("survives storage and tabs API failures", async () => {
    const fake = makeBackgroundBrowser();
    fake.session.get.mockRejectedValue(new Error("no storage"));
    fake.session.set.mockRejectedValue(new Error("no storage"));
    (fake.browser.tabs.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no tabs"));
    g.browser = fake.browser;
    background.main();
    const reply = vi.fn();
    fake.message({ source: MESSAGE_SOURCE, type: "heatmap-state" }, reply);
    fake.message({ source: MESSAGE_SOURCE, type: "heatmap", enabled: true });
    await flush();
    expect(reply).toHaveBeenCalledWith({ enabled: false });
    expect(fake.tabsSendMessage).not.toHaveBeenCalled();
  });
});

/* --- bridge.content.ts --- */

describe("entrypoints/bridge.content", () => {
  let bridge: ContentScript;
  let sendMessage: ReturnType<typeof vi.fn>;
  let onMessage: (event: MessageEvent) => void;
  let runtimeListeners: Array<(message: unknown) => void>;
  let stateResponse: Promise<unknown>;

  beforeAll(async () => {
    bridge = (await import("../../entrypoints/bridge.content")).default as unknown as ContentScript;
  });

  const start = async () => {
    const add = vi.spyOn(window, "addEventListener");
    bridge.main();
    const call = add.mock.calls.find(([type]) => type === "message");
    onMessage = call?.[1] as (event: MessageEvent) => void;
    window.removeEventListener("message", onMessage);
    add.mockRestore();
    await flush();
    // the start-up `heatmap-state` query is not part of the record flow
    sendMessage.mockClear();
  };

  beforeEach(async () => {
    runtimeListeners = [];
    stateResponse = Promise.resolve(undefined);
    sendMessage = vi.fn((message: { type?: string }) =>
      message?.type === "heatmap-state" ? stateResponse : Promise.resolve(),
    );
    g.browser = {
      runtime: {
        sendMessage,
        onMessage: { addListener: (cb: (m: unknown) => void) => runtimeListeners.push(cb) },
      },
    };
    await start();
  });

  const deliver = (data: unknown, source: unknown = window) =>
    onMessage({ source, data } as unknown as MessageEvent);

  it("declares an isolated-world document_start script for every page", () => {
    expect(bridge).toMatchObject({
      matches: ["<all_urls>"],
      runAt: "document_start",
      world: "ISOLATED",
    });
    expect(typeof onMessage).toBe("function");
  });

  it("forwards parsed records, ready messages and pre-parsed records", () => {
    const record = { seq: 1, path: ["quark", "apply"], elementId: null, tag: null, at: 0, meta: {} };
    deliver({ source: MESSAGE_SOURCE, type: "publicize", recordJson: JSON.stringify(record) });
    deliver({ source: MESSAGE_SOURCE, type: "ready" });
    deliver({ source: MESSAGE_SOURCE, type: "publicize", record });
    expect(sendMessage.mock.calls.map(([m]) => m)).toEqual([
      { source: MESSAGE_SOURCE, type: "publicize", record },
      { source: MESSAGE_SOURCE, type: "ready" },
      { source: MESSAGE_SOURCE, type: "publicize", record },
    ]);
  });

  it("ignores other windows, foreign sources, unknown types and bad JSON", () => {
    deliver({ source: MESSAGE_SOURCE, type: "ready" }, {});
    deliver(null);
    deliver({ source: "someone-else", type: "ready" });
    deliver({ source: MESSAGE_SOURCE, type: "inspect" });
    deliver({ source: MESSAGE_SOURCE, type: "publicize", recordJson: "{not json" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("swallows a rejected sendMessage (nobody listening yet)", async () => {
    sendMessage.mockImplementationOnce(() => Promise.reject(new Error("no receiver")));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    deliver({ source: MESSAGE_SOURCE, type: "ready" });
    await flush();
    process.off("unhandledRejection", unhandled);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("forwards heatmap toggles from the runtime to the page", () => {
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    expect(runtimeListeners).toHaveLength(1);
    const [listener] = runtimeListeners;
    listener({ source: MESSAGE_SOURCE, type: "heatmap", enabled: true });
    listener({ source: MESSAGE_SOURCE, type: "heatmap", enabled: "no" });
    listener({ source: MESSAGE_SOURCE, type: "publicize" });
    listener({ source: "someone-else", type: "heatmap", enabled: true });
    listener(null);
    expect(postMessage.mock.calls).toEqual([
      [{ source: MESSAGE_SOURCE, type: "heatmap", enabled: true }, "*"],
      [{ source: MESSAGE_SOURCE, type: "heatmap", enabled: false }, "*"],
    ]);
  });

  it("asks the background for the stored state on start and applies an enabled answer", async () => {
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    stateResponse = Promise.resolve({ enabled: true });
    await start();
    expect(postMessage).toHaveBeenCalledWith(
      { source: MESSAGE_SOURCE, type: "heatmap", enabled: true },
      "*",
    );

    postMessage.mockClear();
    stateResponse = Promise.resolve({ enabled: false });
    await start();
    stateResponse = Promise.reject(new Error("no background"));
    await start();
    expect(postMessage).not.toHaveBeenCalled();
  });
});

/* --- page-hook.content.ts --- */

describe("entrypoints/page-hook.content", () => {
  let pageHook: ContentScript;

  beforeAll(async () => {
    pageHook = (await import("../../entrypoints/page-hook.content")).default as unknown as ContentScript;
  });

  afterEach(() => {
    delete g[PAGE_API_KEY];
    delete g[HOOK_KEY];
  });

  it("installs the page API + hook in the MAIN world and announces itself", () => {
    expect(pageHook).toMatchObject({
      matches: ["<all_urls>"],
      runAt: "document_start",
      world: "MAIN",
    });
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    pageHook.main();

    const api = g[PAGE_API_KEY] as Record<string, unknown>;
    const hook = g[HOOK_KEY] as {
      version: number;
      publicize: (path: string[], meta: Record<string, unknown>) => void;
    };
    expect(typeof api.getElementId).toBe("function");
    expect(typeof api.getLifecycles).toBe("function");
    expect(typeof api.inspect).toBe("function");
    expect(typeof (api.tools as Record<string, unknown>).state_snapshot).toBe("function");
    expect((api.listTools as () => unknown[])().length).toBeGreaterThan(5);
    expect(hook.version).toBe(1);
    expect(postMessage).toHaveBeenCalledWith({ source: MESSAGE_SOURCE, type: "ready" }, "*");

    // chrome-devtools-mcp discovery is answered from the MAIN world
    let group: { name: string } | undefined;
    const discovery = Object.assign(new Event("devtoolstooldiscovery"), {
      respondWith: (g: { name: string }) => {
        group = g;
      },
    });
    window.dispatchEvent(discovery);
    expect(group?.name).toBe("Nucleus Stack");

    // a probe already on the page (injected bundle) is left alone
    postMessage.mockClear();
    pageHook.main();
    expect(postMessage).not.toHaveBeenCalled();
    expect(g[HOOK_KEY]).toBe(hook);

    hook.publicize(["neutron", "effect"], { signature: "sig" });
    const [wire, target] = postMessage.mock.calls.at(-1)!;
    expect(target).toBe("*");
    expect(wire).toMatchObject({ source: MESSAGE_SOURCE, type: "publicize" });
    expect(JSON.parse((wire as { recordJson: string }).recordJson)).toMatchObject({
      seq: 1,
      path: ["neutron", "effect"],
      meta: { signature: "sig" },
    });
  });

  it("toggles the paint heatmap from bridge messages", async () => {
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const add = vi.spyOn(window, "addEventListener");
    pageHook.main();
    const onMessage = add.mock.calls.find(([type]) => type === "message")?.[1] as (
      event: MessageEvent,
    ) => void;
    window.removeEventListener("message", onMessage);
    add.mockRestore();
    const hook = g[HOOK_KEY] as {
      publicize: (path: string[], meta: Record<string, unknown>) => void;
    };
    const el = document.createElement("div");
    document.body.append(el);
    hook.publicize(["quark", "apply"], { weakElement: new WeakRef(el), key: "content" });
    hook.publicize(["quark", "apply"], { weakElement: new WeakRef(el), key: "content" });

    const deliver = (data: unknown, source: unknown = window) =>
      onMessage({ source, data } as unknown as MessageEvent);
    const overlay = () => document.documentElement.querySelector(`[${HEATMAP_ATTR}]`);

    deliver({ source: MESSAGE_SOURCE, type: "heatmap", enabled: true }, {});
    deliver({ source: "someone-else", type: "heatmap", enabled: true });
    deliver({ source: MESSAGE_SOURCE, type: "ready" });
    deliver(null);
    expect(overlay()).toBeNull();

    deliver({ source: MESSAGE_SOURCE, type: "heatmap", enabled: true });
    expect(overlay()?.children).toHaveLength(1);
    expect(overlay()?.children[0].textContent).toBe("2");
    expect(el.attributes).toHaveLength(0);

    deliver({ source: MESSAGE_SOURCE, type: "heatmap", enabled: false });
    expect(overlay()).toBeNull();
    el.remove();
  });
});

/* --- agent-tools.ts (injectable, unlisted) --- */

describe("entrypoints/agent-tools", () => {
  type Unlisted = { main: () => { installed: boolean; tools: string[]; hint: string } };
  let script: Unlisted;

  beforeAll(async () => {
    g.defineUnlistedScript = (main: () => unknown) => ({ main });
    script = (await import("../../entrypoints/agent-tools")).default as unknown as Unlisted;
  });

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    delete g[PAGE_API_KEY];
    delete g[HOOK_KEY];
  });

  it("installs the probe late, announces to producers and reports the tool names", () => {
    const attach = vi.fn();
    globalThis.addEventListener(ATTACH_EVENT, attach);
    const summary = script.main();
    globalThis.removeEventListener(ATTACH_EVENT, attach);
    expect(summary.installed).toBe(true);
    expect(summary.tools).toContain("state_snapshot");
    expect(summary.hint).toMatch(/list_3p_developer_tools/);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(typeof (g[PAGE_API_KEY] as { tools: Record<string, unknown> }).tools.dump).toBe("function");
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Tools ready"));
  });

  it("is a no-op when a hook is already installed, still listing its tools", () => {
    const first = script.main();
    const again = script.main();
    expect(again.installed).toBe(false);
    expect(again.tools).toEqual(first.tools);
    expect(again.hint).toMatch(/already installed/);
  });

  it("copes with a foreign hook that has no page API", () => {
    g[HOOK_KEY] = { version: 1 };
    const summary = script.main();
    expect(summary).toMatchObject({ installed: false, tools: [] });
  });
});

/* --- popup/main.ts --- */

describe("entrypoints/popup", () => {
  const popupHtml = `
    <main id="popup">
      <label><input type="checkbox" id="heatmap-enabled" /> Paint heatmap (whole document)</label>
    </main>`;

  const load = async () => (await import("../../entrypoints/popup/main")).main;

  it("reflects the stored toggle (off by default) and publishes changes", async () => {
    const session = makeSessionStorage();
    const sendMessage = vi.fn(() => Promise.resolve());
    g.browser = { storage: { session }, runtime: { sendMessage } };
    const main = await load();
    document.body.innerHTML = popupHtml;
    await main();
    const checkbox = document.querySelector<HTMLInputElement>("#heatmap-enabled")!;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await flush();
    expect(session.store[HEATMAP_STORAGE_KEY]).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({ source: MESSAGE_SOURCE, type: "heatmap", enabled: true });

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await flush();
    expect(session.store[HEATMAP_STORAGE_KEY]).toBe(false);
    expect(sendMessage).toHaveBeenLastCalledWith({
      source: MESSAGE_SOURCE,
      type: "heatmap",
      enabled: false,
    });
    document.body.innerHTML = "";
  });

  it("starts checked when the session says so", async () => {
    const session = makeSessionStorage({ [HEATMAP_STORAGE_KEY]: true });
    g.browser = { storage: { session }, runtime: { sendMessage: vi.fn(() => Promise.resolve()) } };
    const main = await load();
    document.body.innerHTML = popupHtml;
    await main();
    expect(document.querySelector<HTMLInputElement>("#heatmap-enabled")!.checked).toBe(true);
    document.body.innerHTML = "";
  });

  it("tolerates a missing checkbox and failing storage / messaging", async () => {
    const session = makeSessionStorage();
    session.get.mockRejectedValue(new Error("no storage"));
    session.set.mockRejectedValue(new Error("no storage"));
    const sendMessage = vi.fn(() => Promise.reject(new Error("no background")));
    g.browser = { storage: { session }, runtime: { sendMessage } };
    const main = await load();
    document.body.innerHTML = "";
    await expect(main()).resolves.toBeUndefined();

    document.body.innerHTML = popupHtml;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await main();
    const checkbox = document.querySelector<HTMLInputElement>("#heatmap-enabled")!;
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await flush();
    process.off("unhandledRejection", unhandled);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
    document.body.innerHTML = "";
  });
});

/* --- devtools/main.ts --- */

describe("entrypoints/devtools", () => {
  it("adds the Element sidebar pane to the Elements panel", async () => {
    const pane = { setPage: vi.fn() };
    const createSidebarPane = vi.fn((_title: string, cb: (pane: unknown) => void) => cb(pane));
    g.browser = { devtools: { panels: { elements: { createSidebarPane } } } };
    await import("../../entrypoints/devtools/main");
    expect(createSidebarPane).toHaveBeenCalledWith("Element", expect.any(Function));
    expect(pane.setPage).toHaveBeenCalledWith("element.html");
  });
});

/* --- element/main.ts --- */

describe("entrypoints/element", () => {
  it("installs the @use loader and defines the pane's elements", async () => {
    await import("../../entrypoints/element/main");
    const { Quark } = await import("@excom/quark");
    const { UI_MODULE_URL } = await import("../../lib/quark-modules");
    const ui = await import("../../lib/ui");
    expect(customElements.get("devtools-selection")).toBeDefined();
    expect(customElements.get("quark-sheet")).toBeDefined();
    expect(customElements.get("content-tabs")).toBeDefined();
    await expect(Quark.moduleLoader(UI_MODULE_URL)).resolves.toMatchObject({
      renderTree: ui.renderTree,
    });
  });
});
