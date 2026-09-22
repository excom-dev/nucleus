import { DetectFeatures } from "./detect-features";

DetectFeatures.define();

export { DetectFeatures };

type T_HTMLDetectFeaturesElement = typeof DetectFeatures.CustomElement;
declare global {
  interface HTMLDetectFeaturesElement extends T_HTMLDetectFeaturesElement {}
  interface Window {
    HTMLDetectFeaturesElement: HTMLDetectFeaturesElement;
  }
  interface HTMLElementTagNameMap {
    "detect-features": HTMLDetectFeaturesElement;
  }
}
export type { HTMLDetectFeaturesElement };
