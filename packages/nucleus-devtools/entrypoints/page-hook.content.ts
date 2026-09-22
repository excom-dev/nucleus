import { installPageProbe } from "../lib/install";
import { MESSAGE_SOURCE } from "../lib/protocol";

/**
 * MAIN-world probe. Installed at document_start so Neutron / Quark find the
 * hook before elements construct and sheets register. Logic lives in
 * `lib/install.ts` (hook, page API, agent tools, chrome-devtools-mcp
 * discovery), `lib/page-hook-core.ts` and `lib/heatmap.ts`.
 *
 * The heatmap toggle arrives from the ISOLATED bridge as a `message` event
 * (`{ source, type: "heatmap", enabled }`); the bridge asks the background
 * for the stored state on start so a reload keeps the setting.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const probe = installPageProbe({
      post: (recordJson) => {
        window.postMessage(
          { source: MESSAGE_SOURCE, type: "publicize", recordJson },
          "*",
        );
      },
    });
    // an injected agent-tools bundle got here first (dev only); leave it
    if (!probe) return;

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data as { source?: unknown; type?: unknown; enabled?: unknown } | null;
      if (!data || data.source !== MESSAGE_SOURCE || data.type !== "heatmap") return;
      probe.setHeatmapEnabled(data.enabled === true);
    });

    window.postMessage({ source: MESSAGE_SOURCE, type: "ready" }, "*");
  },
});
