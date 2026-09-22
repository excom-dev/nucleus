import {
  createHeatmap,
  HEATMAP_ATTR,
  paintHue,
  type Heatmap,
} from "../../lib/heatmap";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const overlay = () =>
  document.documentElement.querySelector(`[${HEATMAP_ATTR}]`);
const boxes = () => Array.from(overlay()?.children ?? []) as HTMLElement[];

/** Deterministic frames: `rafs` collects callbacks, `tick()` runs them. */
const fakeFrames = () => {
  const rafs: Array<() => void> = [];
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb) => {
      rafs.push(cb as () => void);
      return rafs.length;
    });
  const caf = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {});
  const tick = () => {
    const pending = rafs.splice(0);
    for (const cb of pending) cb();
  };
  return { rafs, raf, caf, tick };
};

const mount = (tag = "div", rect?: Partial<DOMRect>) => {
  const el = document.createElement(tag);
  document.body.append(el);
  if (rect) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      ...rect,
    } as DOMRect);
  }
  return el;
};

describe("paintHue", () => {
  it("maps fewest → blue (240) and most → red (0)", () => {
    expect(paintHue(1, 3)).toBe(240);
    expect(paintHue(2, 3)).toBe(120);
    expect(paintHue(3, 3)).toBe(0);
    expect(paintHue(1, 11)).toBe(240);
    expect(paintHue(11, 11)).toBe(0);
  });

  it("is blue when everything painted once (max === 1) and clamps outliers", () => {
    expect(paintHue(1, 1)).toBe(240);
    expect(paintHue(1, 0)).toBe(240);
    expect(paintHue(5, 3)).toBe(0);
    expect(paintHue(0, 3)).toBe(240);
  });
});

describe("heatmap", () => {
  let frames: ReturnType<typeof fakeFrames>;
  const created: Heatmap[] = [];
  /** Every heatmap is destroyed after its test so listeners never leak across tests. */
  const make = (options?: Parameters<typeof createHeatmap>[0]) => {
    const heatmap = createHeatmap(options);
    created.push(heatmap);
    return heatmap;
  };

  beforeEach(() => {
    frames = fakeFrames();
  });

  afterEach(() => {
    for (const heatmap of created.splice(0)) heatmap.destroy();
    overlay()?.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is off by default and counts without rendering or scheduling", () => {
    const heatmap = make();
    const el = mount();
    expect(heatmap.isEnabled()).toBe(false);
    heatmap.record(el);
    heatmap.record(el);
    heatmap.render();
    expect(overlay()).toBeNull();
    expect(frames.raf).not.toHaveBeenCalled();
  });

  it("never writes attributes or inline styles on page elements", () => {
    const heatmap = make();
    const el = mount("p");
    heatmap.setEnabled(true);
    heatmap.record(el);
    frames.tick();
    expect(overlay()).not.toBeNull();
    expect(el.attributes.length).toBe(0);
    expect(el.getAttribute("style")).toBeNull();
    expect(el.children.length).toBe(0);
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("enabling renders one overlay box per live painted element, colored by count", () => {
    const heatmap = make();
    const a = mount("div", { left: 10, top: 20, width: 100, height: 30 });
    const b = mount("span", { left: 5, top: 5, width: 50, height: 10 });
    const c = mount("i");
    heatmap.record(a);
    heatmap.record(a);
    heatmap.record(a);
    heatmap.record(b);
    heatmap.record(c);
    heatmap.record(c);
    expect(overlay()).toBeNull();

    heatmap.setEnabled(true);
    expect(heatmap.isEnabled()).toBe(true);
    const host = overlay() as HTMLElement;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.getAttribute("style")).toContain("position:fixed");
    expect(host.getAttribute("style")).toContain("inset:0");
    expect(host.getAttribute("style")).toContain("pointer-events:none");
    expect(host.getAttribute("style")).toContain("z-index:2147483647");

    const items = boxes();
    expect(items).toHaveLength(3);
    const [boxA, boxB, boxC] = items;
    // a: 3 of max 3 → red; b: 1 → blue; c: 2 → green (120)
    expect(boxA.getAttribute("style")).toContain(
      "left:10px;top:20px;width:100px;height:30px"
    );
    expect(boxA.getAttribute("style")).toContain(
      "background:hsl(0 100% 50% / 0.35)"
    );
    expect(boxA.getAttribute("style")).toContain(
      "outline:1px solid hsl(0 100% 50%)"
    );
    expect(boxA.textContent).toBe("3");
    expect(boxB.getAttribute("style")).toContain("hsl(240 100% 50% / 0.35)");
    expect(boxB.textContent).toBe("1");
    expect(boxC.getAttribute("style")).toContain("hsl(120 100% 50% / 0.35)");
    expect(boxC.textContent).toBe("2");
  });

  it("uses hue 240 for every box while max is 1", () => {
    const heatmap = make();
    heatmap.record(mount());
    heatmap.record(mount());
    heatmap.setEnabled(true);
    for (const box of boxes()) {
      expect(box.getAttribute("style")).toContain("hsl(240 100% 50% / 0.35)");
    }
  });

  it("re-renders one frame per burst of records while enabled", () => {
    const heatmap = make();
    const el = mount();
    heatmap.setEnabled(true);
    heatmap.record(el);
    heatmap.record(el);
    heatmap.record(el);
    expect(frames.raf).toHaveBeenCalledTimes(1);
    expect(boxes()).toHaveLength(0);
    frames.tick();
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].textContent).toBe("3");
    heatmap.record(el);
    expect(frames.raf).toHaveBeenCalledTimes(2);
    frames.tick();
    expect(boxes()[0].textContent).toBe("4");
    expect(boxes()).toHaveLength(1);
  });

  it("re-renders on scroll (capture) and resize, throttled to one frame", () => {
    const heatmap = make();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    heatmap.record(mount());
    heatmap.setEnabled(true);
    expect(add).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(add).toHaveBeenCalledWith("resize", expect.any(Function));

    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
    expect(frames.raf).toHaveBeenCalledTimes(1);
    frames.tick();
    expect(boxes()).toHaveLength(1);

    heatmap.setEnabled(false);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    window.dispatchEvent(new Event("scroll"));
    expect(frames.raf).toHaveBeenCalledTimes(1);
  });

  it("disabling removes the overlay, cancels a pending frame and keeps the counts", () => {
    const heatmap = make();
    const el = mount();
    heatmap.setEnabled(true);
    heatmap.record(el);
    expect(frames.rafs).toHaveLength(1);
    heatmap.setEnabled(false);
    expect(frames.caf).toHaveBeenCalledTimes(1);
    expect(overlay()).toBeNull();
    expect(heatmap.isEnabled()).toBe(false);
    // the frame callback, if the browser still fires it, is inert
    frames.tick();
    expect(overlay()).toBeNull();
    // toggling twice the same way is a no-op
    heatmap.setEnabled(false);
    heatmap.setEnabled(true);
    heatmap.setEnabled(true);
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].textContent).toBe("1");
  });

  it("skips disconnected elements and prunes dead WeakRefs", () => {
    const dead = new Set<Element>();
    class FakeWeakRef<T extends object> {
      #target: T;
      constructor(target: T) {
        this.#target = target;
      }
      deref(): T | undefined {
        return dead.has(this.#target as unknown as Element)
          ? undefined
          : this.#target;
      }
    }
    vi.stubGlobal("WeakRef", FakeWeakRef);

    const heatmap = make();
    const a = mount();
    const b = mount();
    const detached = document.createElement("div");
    heatmap.record(a);
    heatmap.record(b);
    heatmap.record(detached);
    heatmap.setEnabled(true);
    expect(boxes()).toHaveLength(2);

    dead.add(b);
    heatmap.render();
    expect(boxes()).toHaveLength(1);
    // a collected element stays gone even if something with its identity paints again
    dead.delete(b);
    heatmap.render();
    expect(boxes()).toHaveLength(1);
  });

  it("destroy() disables and forgets everything", () => {
    const heatmap = make();
    const el = mount();
    heatmap.record(el);
    heatmap.setEnabled(true);
    expect(boxes()).toHaveLength(1);
    heatmap.destroy();
    expect(overlay()).toBeNull();
    expect(heatmap.isEnabled()).toBe(false);
    heatmap.setEnabled(true);
    expect(boxes()).toHaveLength(0);
  });

  it("top() ranks live painted elements by count whether or not the overlay is on", () => {
    const heatmap = make();
    const a = mount();
    const b = mount();
    const gone = mount();
    heatmap.record(a);
    heatmap.record(b);
    heatmap.record(b);
    heatmap.record(gone);
    expect(heatmap.top()).toEqual([
      { element: b, count: 2 },
      { element: a, count: 1 },
      { element: gone, count: 1 },
    ]);
    expect(heatmap.top(1)).toEqual([{ element: b, count: 2 }]);
    expect(heatmap.top(0)).toEqual([]);
    expect(heatmap.top(-1)).toEqual([]);
    // disconnected elements still count (they may come back); destroy forgets them
    gone.remove();
    expect(heatmap.top()).toHaveLength(3);
    heatmap.destroy();
    expect(heatmap.top()).toEqual([]);
  });

  it("works on an injected document", () => {
    const doc = document.implementation.createHTMLDocument("other");
    const heatmap = make({ doc });
    const el = doc.createElement("div");
    doc.body.append(el);
    heatmap.record(el);
    heatmap.setEnabled(true);
    expect(
      document.documentElement.querySelector(`[${HEATMAP_ATTR}]`)
    ).toBeNull();
    expect(
      doc.documentElement.querySelector(`[${HEATMAP_ATTR}]`)?.children
    ).toHaveLength(1);
    heatmap.destroy();
  });
});
