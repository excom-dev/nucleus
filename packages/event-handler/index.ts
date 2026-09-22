import { EventHandler } from "./event-handler";

EventHandler.define();

export { EventHandler };

type T_HTMLEventHandlerElement = typeof EventHandler.CustomElement;
declare global {
  interface HTMLEventHandlerElement extends T_HTMLEventHandlerElement {}
  interface Window {
    HTMLEventHandlerElement: HTMLEventHandlerElement;
  }
  interface HTMLElementTagNameMap {
    "event-handler": HTMLEventHandlerElement;
  }
}
export type { HTMLEventHandlerElement };
