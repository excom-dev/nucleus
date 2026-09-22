/**
 * Paint-count heatmap for the whole document.
 *
 * All state lives here, in the extension's MAIN-world script: the page's
 * elements are never written to (no attributes, no inline styles). Counts
 * are keyed weakly; iteration uses `WeakRef`s that are pruned as they die,
 * so the heatmap never keeps a page element alive.
 *
 * Rendering is one fixed, pointer-transparent overlay appended to
 * `document.documentElement` holding one absolutely positioned box per
 * painted element (from `getBoundingClientRect()`), colored from blue
 * (fewest paints) to red (most) with the old `?nq-debug` formula.
 */

export const HEATMAP_ATTR = "data-nucleus-heatmap";

export type Heatmap = {
  /** Count one paint of `el`; schedules a render while enabled. */
  record: (el: Element) => void;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  /** Draw (or redraw) the overlay now. No-op while disabled. */
  render: () => void;
  /** Disable, drop the overlay and every reference. */
  destroy: () => void;
  /**
   * The `n` most-painted live elements, most first. Counts accumulate
   * from page load whether or not the overlay is enabled.
   */
  top: (n?: number) => Array<{ element: Element; count: number }>;
};

export type HeatmapOptions = {
  doc?: Document;
};

/**
 * hue = (1 − (count − 1) / (max − 1)) × 240: blue (240) for the fewest
 * paints, red (0) for the most. With a single paint level everything is blue.
 */
export const paintHue = (count: number, max: number): number => {
  if (max <= 1) return 240;
  const ratio = Math.min(Math.max((count - 1) / (max - 1), 0), 1);
  return (1 - ratio) * 240;
};

export const createHeatmap = ({
  doc = document,
}: HeatmapOptions = {}): Heatmap => {
  const counts = new WeakMap<Element, number>();
  let refs: Array<WeakRef<Element>> = [];
  let max = 0;
  let enabled = false;
  let overlay: HTMLElement | null = null;
  let frame: number | null = null;

  const view = () => doc.defaultView ?? globalThis;

  const schedule = () => {
    if (!enabled || frame !== null) return;
    frame = view().requestAnimationFrame(() => {
      frame = null;
      render();
    });
  };

  const cancel = () => {
    if (frame === null) return;
    view().cancelAnimationFrame(frame);
    frame = null;
  };

  /** Live elements only; dead refs are dropped as they are met. */
  const live = (): Element[] => {
    const alive: Element[] = [];
    const kept: Array<WeakRef<Element>> = [];
    for (const ref of refs) {
      const el = ref.deref();
      if (!el) continue;
      alive.push(el);
      kept.push(ref);
    }
    refs = kept;
    return alive;
  };

  const ensureOverlay = (): HTMLElement => {
    if (overlay) return overlay;
    overlay = doc.createElement("div");
    overlay.setAttribute(HEATMAP_ATTR, "");
    overlay.setAttribute(
      "style",
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647;margin:0;padding:0;border:0;overflow:hidden;font:10px/1 system-ui,sans-serif;"
    );
    doc.documentElement.append(overlay);
    return overlay;
  };

  const removeOverlay = () => {
    overlay?.remove();
    overlay = null;
  };

  const box = (el: Element, count: number): HTMLElement => {
    const rect = el.getBoundingClientRect();
    const hue = paintHue(count, max);
    const item = doc.createElement("div");
    item.setAttribute(
      "style",
      `position:absolute;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;` +
        `background:hsl(${hue} 100% 50% / 0.35);outline:1px solid hsl(${hue} 100% 50%);outline-offset:-1px;`
    );
    const label = doc.createElement("span");
    label.setAttribute(
      "style",
      `position:absolute;left:0;top:0;padding:0 3px;color:#fff;background:hsl(${hue} 100% 35%);`
    );
    label.textContent = String(count);
    item.append(label);
    return item;
  };

  const render = () => {
    if (!enabled) return;
    const host = ensureOverlay();
    const next = doc.createDocumentFragment();
    for (const el of live()) {
      const count = counts.get(el) ?? 0;
      if (count > 0 && el.isConnected) next.append(box(el, count));
    }
    host.replaceChildren(next);
  };

  const onViewportChange = () => schedule();

  const listen = () => {
    view().addEventListener("scroll", onViewportChange, true);
    view().addEventListener("resize", onViewportChange);
  };
  const unlisten = () => {
    view().removeEventListener("scroll", onViewportChange, true);
    view().removeEventListener("resize", onViewportChange);
  };

  const record = (el: Element) => {
    const count = (counts.get(el) ?? 0) + 1;
    if (count === 1) refs.push(new WeakRef(el));
    counts.set(el, count);
    if (count > max) max = count;
    schedule();
  };

  const setEnabled = (next: boolean) => {
    const value = !!next;
    if (value === enabled) return;
    enabled = value;
    if (enabled) {
      listen();
      render();
    } else {
      cancel();
      unlisten();
      removeOverlay();
    }
  };

  const destroy = () => {
    setEnabled(false);
    refs = [];
    max = 0;
  };

  const top = (n = 20) =>
    live()
      .map((element) => ({ element, count: counts.get(element) ?? 0 }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(0, n));

  return { record, setEnabled, isEnabled: () => enabled, render, destroy, top };
};
