import { DismissWatcher } from "./dismiss-watcher";

DismissWatcher.define();

export { DismissWatcher };
export type {
  DismissWatcherDismissEvent,
  DismissWatcherReason,
} from "./dismiss-watcher";

type T_HTMLDismissWatcherElement = typeof DismissWatcher.CustomElement;
declare global {
  interface HTMLDismissWatcherElement extends T_HTMLDismissWatcherElement {}
  interface Window {
    HTMLDismissWatcherElement: HTMLDismissWatcherElement;
  }
  interface HTMLElementTagNameMap {
    "dismiss-watcher": HTMLDismissWatcherElement;
  }
}
export type { HTMLDismissWatcherElement };
