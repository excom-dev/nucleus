import { ServiceWorker } from "./service-worker";

ServiceWorker.define();

export { ServiceWorker };

type T_HTMLServiceWorkerElement = typeof ServiceWorker.CustomElement;
declare global {
  interface HTMLServiceWorkerElement extends T_HTMLServiceWorkerElement {}
  interface Window {
    HTMLServiceWorkerElement: HTMLServiceWorkerElement;
  }
  interface HTMLElementTagNameMap {
    "service-worker": HTMLServiceWorkerElement;
  }
}
export type { HTMLServiceWorkerElement };
