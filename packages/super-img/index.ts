import { SuperImg } from "./super-img";

SuperImg.define();

export { SuperImg };

type T_HTMLSuperImgElement = typeof SuperImg.CustomElement;
declare global {
  interface HTMLSuperImgElement extends T_HTMLSuperImgElement {}
  interface Window {
    HTMLSuperImgElement: HTMLSuperImgElement;
  }
  interface HTMLElementTagNameMap {
    "super-img": HTMLSuperImgElement;
  }
}
export type { HTMLSuperImgElement };
