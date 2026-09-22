import { DetectBrowser } from "./detect-browser";

DetectBrowser.define();

export { DetectBrowser };

type T_HTMLDetectBrowserElement = typeof DetectBrowser.CustomElement;
declare global {
  interface HTMLDetectBrowserElement extends T_HTMLDetectBrowserElement {}
  interface Window {
    HTMLDetectBrowserElement: HTMLDetectBrowserElement;
  }
  interface HTMLElementTagNameMap {
    "detect-browser": HTMLDetectBrowserElement;
  }
}
export type { HTMLDetectBrowserElement };
