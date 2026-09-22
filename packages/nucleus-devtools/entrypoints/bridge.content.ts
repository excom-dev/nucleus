import {
  MESSAGE_SOURCE,
  type BridgeMessage,
  type HeatmapStateResponse,
} from "../lib/protocol";

type WireMessage =
  | BridgeMessage
  | {
      source: typeof MESSAGE_SOURCE;
      type: "publicize";
      recordJson: string;
    };

/**
 * Isolated-world bridge, both directions:
 * - page postMessage → extension runtime (JSON-stringified records from the
 *   MAIN-world hook);
 * - extension runtime → page postMessage (the global heatmap toggle, relayed
 *   by the background, plus the stored state asked for on start).
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "ISOLATED",
  main() {
    const toPage = (enabled: boolean) => {
      window.postMessage(
        { source: MESSAGE_SOURCE, type: "heatmap", enabled },
        "*"
      );
    };

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data as WireMessage | null;
      if (!data || data.source !== MESSAGE_SOURCE) return;

      let message: BridgeMessage;
      if (data.type === "publicize" && "recordJson" in data) {
        try {
          message = {
            source: MESSAGE_SOURCE,
            type: "publicize",
            record: JSON.parse(data.recordJson),
          };
        } catch {
          return;
        }
      } else if (data.type === "publicize" || data.type === "ready") {
        message = data;
      } else {
        return;
      }

      browser.runtime.sendMessage(message).catch(() => {
        // DevTools / background may not be listening yet.
      });
    });

    browser.runtime.onMessage.addListener((message: BridgeMessage) => {
      if (message?.source !== MESSAGE_SOURCE || message.type !== "heatmap")
        return;
      toPage(message.enabled === true);
    });

    const query: BridgeMessage = {
      source: MESSAGE_SOURCE,
      type: "heatmap-state",
    };
    browser.runtime
      .sendMessage(query)
      .then((response: HeatmapStateResponse | undefined) => {
        if (response?.enabled === true) toPage(true);
      })
      .catch(() => {
        // No background yet: the toggle arrives later as a runtime message.
      });
  },
});
