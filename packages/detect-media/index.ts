import { DetectMedia } from "./detect-media";

DetectMedia.define();

export { DetectMedia };
export type {
  DetectMediaChangeEvent,
  DetectMediaProvision,
} from "./detect-media";

type T_HTMLDetectMediaElement = typeof DetectMedia.CustomElement;
declare global {
  interface HTMLDetectMediaElement extends T_HTMLDetectMediaElement {}
  interface Window {
    HTMLDetectMediaElement: HTMLDetectMediaElement;
  }
  interface HTMLElementTagNameMap {
    "detect-media": HTMLDetectMediaElement;
  }
}
export type { HTMLDetectMediaElement };
