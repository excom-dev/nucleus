import type { DomWindow } from "./window";

/**
 * APIs happy-dom lacks: a `ServiceWorkerContainer` class and
 * `checkVisibility()`, always `true` (no layout).
 */
export function installMissingApis(win: DomWindow | typeof globalThis): void {
  (win as { ServiceWorkerContainer?: unknown }).ServiceWorkerContainer ??=
    class ServiceWorkerContainer {};
  win.Element.prototype.checkVisibility ??= () => true;
}
