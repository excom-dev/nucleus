import { DomObserver } from "./dom-observer";

DomObserver.define();

export { DomObserver };

type T_HTMLDomObserverElement = typeof DomObserver.CustomElement;
declare global {
  interface HTMLDomObserverElement extends T_HTMLDomObserverElement {}
  interface Window {
    HTMLDomObserverElement: HTMLDomObserverElement;
  }
  interface HTMLElementTagNameMap {
    "dom-observer": HTMLDomObserverElement;
  }
}
export type { HTMLDomObserverElement };
