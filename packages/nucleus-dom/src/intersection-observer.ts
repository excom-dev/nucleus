import type { DomWindow } from "./window";

// happy-dom's takes its fields; the DOM typings dropped the argument
type Entry = new (
  init: Partial<IntersectionObserverEntry>
) => IntersectionObserverEntry;

/**
 * An `IntersectionObserver` that sees every observed element in view: a
 * frame after `observe()`, a connected target is reported intersecting
 * (ratio 1), a detached one not. happy-dom's never reports, so lazy-loaded
 * content would never render on the server.
 */
export function reportIntersecting(win: DomWindow): void {
  win.IntersectionObserver = class IntersectionObserver extends (
    win.IntersectionObserver
  ) {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number>;
    #callback: IntersectionObserverCallback;
    #observed = new Set<Element>();
    #due = new Set<Element>();
    #frame = false;

    constructor(
      callback: IntersectionObserverCallback,
      options: IntersectionObserverInit = {}
    ) {
      super(callback, options);
      this.#callback = callback;
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? "0px 0px 0px 0px";
      this.thresholds = [options.threshold ?? 0].flat().sort((a, b) => a - b);
    }

    observe(target: Element): void {
      if (this.#observed.has(target)) return;
      this.#observed.add(target);
      this.#due.add(target);
      if (this.#frame) return;
      this.#frame = true;
      win.requestAnimationFrame(() => {
        this.#frame = false;
        const entries = this.takeRecords();
        if (entries.length) this.#callback.call(this, entries, this);
      });
    }

    unobserve(target: Element): void {
      this.#observed.delete(target);
      this.#due.delete(target);
    }

    disconnect(): void {
      this.#observed.clear();
      this.#due.clear();
    }

    takeRecords(): IntersectionObserverEntry[] {
      const entries = [...this.#due].map((target) => {
        const rect = target.getBoundingClientRect();
        const ratio = target.isConnected ? 1 : 0;
        return new (win.IntersectionObserverEntry as unknown as Entry)({
          target,
          time: win.performance.now(),
          isIntersecting: !!ratio,
          intersectionRatio: ratio,
          boundingClientRect: rect,
          intersectionRect: rect,
          rootBounds: new win.DOMRect(0, 0, win.innerWidth, win.innerHeight),
        });
      });
      this.#due.clear();
      return entries;
    }
  };
}
