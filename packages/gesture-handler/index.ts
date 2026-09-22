import { GestureHandler } from "./gesture-handler";

GestureHandler.define();

export { GestureHandler };
export type {
  GestureHandlerCancelEvent,
  GestureHandlerEndEvent,
  GestureHandlerMoveEvent,
  GestureHandlerPointEvent,
  GestureHandlerProvision,
  GestureHandlerSnapEvent,
  GestureHandlerStartEvent,
  GestureHandlerSwipeEvent,
  GestureHandlerValues,
  GestureType,
} from "./gesture-handler";

type T_HTMLGestureHandlerElement = typeof GestureHandler.CustomElement;
declare global {
  interface HTMLGestureHandlerElement extends T_HTMLGestureHandlerElement {}
  interface Window {
    HTMLGestureHandlerElement: HTMLGestureHandlerElement;
  }
  interface HTMLElementTagNameMap {
    "gesture-handler": HTMLGestureHandlerElement;
  }
}
export type { HTMLGestureHandlerElement };
