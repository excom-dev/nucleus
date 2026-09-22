import {
  HEATMAP_STORAGE_KEY,
  MESSAGE_SOURCE,
  PORT_NAME,
  type BridgeMessage,
  type HeatmapStateResponse,
} from "../lib/protocol";

/**
 * WXT dev manifests omit `content_scripts`; the server registers them
 * over a websocket after the background connects. Miss that handshake
 * (worker asleep, server restart, tab first) and the MAIN-world probe
 * never installs. Self-register with WXT's ids (`wxt:<bundle path>`) so
 * a dev build works as soon as the background starts. Production ships
 * the scripts in the manifest and skips this.
 */
const DEV_CONTENT_SCRIPTS = [
  {
    id: "wxt:content-scripts/page-hook.js",
    js: ["content-scripts/page-hook.js"],
    matches: ["<all_urls>"],
    runAt: "document_start",
    world: "MAIN",
  },
  {
    id: "wxt:content-scripts/bridge.js",
    js: ["content-scripts/bridge.js"],
    matches: ["<all_urls>"],
    runAt: "document_start",
    world: "ISOLATED",
  },
] as const;

const ensureDevContentScripts = async () => {
  if (!import.meta.env.DEV) return;
  try {
    const registered = await browser.scripting.getRegisteredContentScripts();
    const missing = DEV_CONTENT_SCRIPTS.filter(
      (script) => !registered.some((entry) => entry.id === script.id),
    );
    if (missing.length) {
      await browser.scripting.registerContentScripts(
        missing.map((script) => ({ ...script, js: [...script.js], matches: [...script.matches] })),
      );
      console.info(
        `[nucleus-devtools] registered dev content scripts (${missing
          .map((s) => s.id)
          .join(", ")}) — reload pages opened before this.`,
      );
    }
  } catch (err) {
    console.warn("[nucleus-devtools] could not register dev content scripts", err);
  }
};

/** The global heatmap toggle, kept for the browser session. */
const readHeatmapEnabled = async (): Promise<boolean> => {
  try {
    const stored = await browser.storage.session.get(HEATMAP_STORAGE_KEY);
    return stored?.[HEATMAP_STORAGE_KEY] === true;
  } catch {
    return false;
  }
};

const writeHeatmapEnabled = async (enabled: boolean) => {
  try {
    await browser.storage.session.set({ [HEATMAP_STORAGE_KEY]: enabled });
  } catch {
    // storage unavailable: the fan-out below still reaches open tabs
  }
};

/** Tell every tab's bridge; tabs without the content script just reject. */
const broadcastHeatmap = async (enabled: boolean) => {
  const message: BridgeMessage = { source: MESSAGE_SOURCE, type: "heatmap", enabled };
  let tabs: Array<{ id?: number }> = [];
  try {
    tabs = await browser.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? undefined
        : browser.tabs.sendMessage(tab.id, message).catch(() => {
            // no bridge in this tab
          }),
    ),
  );
};

/**
 * Relays page publications to connected DevTools Element panes, and the
 * popup's heatmap toggle to every tab's bridge (also answering the bridges'
 * `heatmap-state` query with the stored value).
 * Long-lived ports + DevTools pings keep this SW from sleeping mid-session.
 */
export default defineBackground(() => {
  void ensureDevContentScripts();

  const ports = new Set<Browser.runtime.Port>();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    ports.add(port);
    port.onMessage.addListener(() => {
      // DevTools keepalive pings, no-op, connection itself retains the SW.
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });
  });

  browser.runtime.onMessage.addListener(
    (
      message: BridgeMessage,
      _sender: unknown,
      sendResponse: (response: HeatmapStateResponse) => void,
    ) => {
      if (message?.source !== MESSAGE_SOURCE) return;
      if (message.type === "heatmap") {
        const enabled = message.enabled === true;
        void writeHeatmapEnabled(enabled).then(() => broadcastHeatmap(enabled));
        return;
      }
      if (message.type === "heatmap-state") {
        void readHeatmapEnabled().then((enabled) => sendResponse({ enabled }));
        return true; // async response
      }
      if (message.type !== "publicize") return;
      for (const port of ports) {
        try {
          port.postMessage(message);
        } catch {
          ports.delete(port);
        }
      }
    },
  );
});
