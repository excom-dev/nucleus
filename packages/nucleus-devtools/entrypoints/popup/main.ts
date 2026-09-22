import "./popup.css";
import {
  HEATMAP_STORAGE_KEY,
  MESSAGE_SOURCE,
  type BridgeMessage,
} from "../../lib/protocol";

/**
 * Toolbar popup: the global "Paint heatmap" toggle. Reads the stored value
 * on open, writes it on change and tells the background, which fans the
 * change out to every tab's bridge. Off by default.
 */
export const main = async (root: Document = document) => {
  const checkbox = root.querySelector<HTMLInputElement>("#heatmap-enabled");
  if (!checkbox) return;
  try {
    const stored = await browser.storage.session.get(HEATMAP_STORAGE_KEY);
    checkbox.checked = stored?.[HEATMAP_STORAGE_KEY] === true;
  } catch {
    checkbox.checked = false;
  }
  checkbox.addEventListener("change", () => {
    const enabled = checkbox.checked;
    const message: BridgeMessage = {
      source: MESSAGE_SOURCE,
      type: "heatmap",
      enabled,
    };
    void browser.storage.session
      .set({ [HEATMAP_STORAGE_KEY]: enabled })
      .catch(() => {
        // storage unavailable: the background still relays the toggle
      });
    browser.runtime.sendMessage(message).catch(() => {
      // background not awake yet
    });
  });
};

void main();
