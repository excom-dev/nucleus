import {
  getNearestScrollableContainer,
  scrollElementIntoView,
} from "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

type Box = { top?: number; bottom?: number; left?: number; right?: number };

/** Stub an element's layout box (happy-dom has no layout). */
const setRect = (el: Element, { top = 0, bottom = 0, left = 0, right = 0 }: Box) => {
  (el as any).getBoundingClientRect = () => ({
    top,
    bottom,
    left,
    right,
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
};

const defineOwn = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { value, configurable: true, writable: true });

/** A scroll container that `getNearestScrollableContainer` recognizes. */
const makeScroller = (
  axis: "x" | "y",
  { scrollSize, clientSize, scrollPos, box }: { scrollSize: number; clientSize: number; scrollPos: number; box: Box }
) => {
  const c = document.createElement("div");
  if (axis === "y") {
    c.style.overflowY = "auto";
    defineOwn(c, "scrollHeight", scrollSize);
    defineOwn(c, "clientHeight", clientSize);
    c.scrollTop = scrollPos;
  } else {
    c.style.overflowX = "auto";
    defineOwn(c, "scrollWidth", scrollSize);
    defineOwn(c, "clientWidth", clientSize);
    c.scrollLeft = scrollPos;
  }
  setRect(c, box);
  const el = document.createElement("span");
  c.appendChild(el);
  document.body.appendChild(c);
  const scrollTo = vi.spyOn(c, "scrollTo").mockImplementation(() => {});
  return { c, el, scrollTo };
};

describe("getNearestScrollableContainer (extra branches)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (document as any).scrollingElement;
  });

  it("stops at fixed-position elements and falls back to the document", () => {
    const scroller = makeScroller("y", { scrollSize: 500, clientSize: 100, scrollPos: 0, box: {} }).c;
    const fixed = document.createElement("div");
    fixed.style.position = "fixed";
    const child = document.createElement("div");
    fixed.appendChild(child);
    scroller.appendChild(fixed);
    expect(getNearestScrollableContainer(child)).toBe(document);
  });

  it("hops out of a shadow root to find a scrollable host ancestor", () => {
    const { c: scroller } = makeScroller("y", { scrollSize: 500, clientSize: 100, scrollPos: 0, box: {} });
    const host = document.createElement("div");
    scroller.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("p");
    root.appendChild(inner);
    expect(getNearestScrollableContainer(inner)).toBe(scroller);
  });

  it("returns the document for a detached node", () => {
    const orphan = document.createElement("div");
    expect(getNearestScrollableContainer(orphan)).toBe(document);
  });

  it("still normalizes to the document when scrollingElement is null", () => {
    Object.defineProperty(document, "scrollingElement", { get: () => null, configurable: true });
    const child = document.createElement("div");
    document.body.appendChild(child);
    expect(getNearestScrollableContainer(child)).toBe(document);
  });
});

describe("scrollElementIntoView in the viewport", () => {
  let scrollTo: ReturnType<typeof vi.spyOn>;
  let el: HTMLElement;

  beforeEach(() => {
    window.innerHeight = 500;
    window.innerWidth = 800;
    defineOwn(window, "scrollY", 100);
    defineOwn(window, "scrollX", 20);
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    el = document.createElement("div");
    document.body.appendChild(el);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as any).scrollY;
    delete (window as any).scrollX;
    vi.restoreAllMocks();
  });

  it("ignores objects without getBoundingClientRect", () => {
    expect(scrollElementIntoView({} as any, { block: "start" })).toEqual({});
  });

  it("block start honours offsetBlock and behavior", () => {
    setRect(el, { top: 200, bottom: 250 });
    const result = scrollElementIntoView(el, {
      block: "start",
      offsetBlock: -10,
      onlyIfNeeded: false,
      behavior: "instant",
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 290, behavior: "instant" });
    expect(result).toEqual({ y: document });
  });

  it("block end aligns the bottom edge with the viewport bottom", () => {
    setRect(el, { top: 200, bottom: 250 });
    scrollElementIntoView(el, { block: "end", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenCalledWith({ top: -150, behavior: "smooth" });
  });

  it("block center centers the element", () => {
    setRect(el, { top: 200, bottom: 250 });
    scrollElementIntoView(el, { block: "center", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenCalledWith({ top: 75, behavior: "smooth" });
  });

  it("unknown alignment falls back to start", () => {
    setRect(el, { top: 200, bottom: 250 });
    scrollElementIntoView(el, { block: "bogus" as any, onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: "smooth" });
  });

  it("block nearest keeps the current position when fully visible and forced", () => {
    setRect(el, { top: 200, bottom: 250 });
    scrollElementIntoView(el, { block: "nearest", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenCalledWith({ top: 100, behavior: "smooth" });
  });

  it("block nearest scrolls up for an element above the viewport", () => {
    setRect(el, { top: -50, bottom: 0 });
    const result = scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenCalledWith({ top: 50, behavior: "smooth" });
    expect(result.y).toBe(document);
  });

  it("block nearest scrolls down for an element below the viewport", () => {
    setRect(el, { top: 600, bottom: 650 });
    scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenCalledWith({ top: 250, behavior: "smooth" });
  });

  it("block nearest picks the smaller move for an element taller than the viewport", () => {
    setRect(el, { top: -50, bottom: 600 });
    scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 50, behavior: "smooth" });

    setRect(el, { top: -300, bottom: 550 });
    scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 150, behavior: "smooth" });
  });

  it("does not scroll when onlyIfNeeded and fully in view", () => {
    setRect(el, { top: 200, bottom: 250 });
    const result = scrollElementIntoView(el, { block: "start" });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(result).toEqual({ y: document });
  });

  it("respects padInView when deciding whether a scroll is needed", () => {
    setRect(el, { top: 5, bottom: 50 });
    scrollElementIntoView(el, { block: "start", padInView: 10 });
    expect(scrollTo).toHaveBeenCalledWith({ top: 105, behavior: "smooth" });
  });

  it("skips the scroll when only the offset pad is violated but nearest is satisfied", () => {
    setRect(el, { top: 5, bottom: 50 });
    const result = scrollElementIntoView(el, { block: "nearest", offsetBlock: 10 });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it("inline start scrolls horizontally with offsetInline", () => {
    setRect(el, { left: 100, right: 200 });
    const result = scrollElementIntoView(el, {
      inline: "start",
      offsetInline: 5,
      onlyIfNeeded: false,
    });
    expect(scrollTo).toHaveBeenCalledWith({ left: 125, behavior: "smooth" });
    expect(result).toEqual({ x: document });
  });

  it("inline end and center", () => {
    setRect(el, { left: 100, right: 200 });
    scrollElementIntoView(el, { inline: "end", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: -580, behavior: "smooth" });
    scrollElementIntoView(el, { inline: "center", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: -230, behavior: "smooth" });
  });

  it("inline nearest scrolls left for an element off the left edge", () => {
    setRect(el, { left: -30, right: 10 });
    scrollElementIntoView(el, { inline: "nearest" });
    expect(scrollTo).toHaveBeenCalledWith({ left: -10, behavior: "smooth" });
  });

  it("inline nearest scrolls right for an element off the right edge", () => {
    setRect(el, { left: 900, right: 950 });
    scrollElementIntoView(el, { inline: "nearest" });
    expect(scrollTo).toHaveBeenCalledWith({ left: 170, behavior: "smooth" });
  });

  it("inline nearest handles elements wider than the viewport", () => {
    setRect(el, { left: -10, right: 900 });
    scrollElementIntoView(el, { inline: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 10, behavior: "smooth" });
    setRect(el, { left: -400, right: 810 });
    scrollElementIntoView(el, { inline: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 30, behavior: "smooth" });
  });

  it("inline defaults to nearest and does nothing when already visible", () => {
    setRect(el, { left: 100, right: 200 });
    const result = scrollElementIntoView(el, { inline: "nearest" });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(result).toEqual({ x: document });
  });

  it("scrolls both axes in one call", () => {
    setRect(el, { top: 600, bottom: 650, left: 900, right: 950 });
    const result = scrollElementIntoView(el, { block: "start", inline: "start" });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ x: document, y: document });
  });
});

describe("scrollElementIntoView inside a scroll container", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const yScroller = () =>
    makeScroller("y", {
      scrollSize: 1000,
      clientSize: 200,
      scrollPos: 50,
      box: { top: 100, bottom: 300, left: 0, right: 400 },
    });

  it("block start / end / center / fallback target the container", () => {
    const { c, el, scrollTo } = yScroller();
    setRect(el, { top: 350, bottom: 400 });

    const result = scrollElementIntoView(el, { block: "start", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: "smooth" });
    expect(result).toEqual({ y: c });

    scrollElementIntoView(el, { block: "end", onlyIfNeeded: false, behavior: "auto" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 150, behavior: "auto" });

    scrollElementIntoView(el, { block: "center", onlyIfNeeded: false, offsetBlock: 1 });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 226, behavior: "smooth" });

    scrollElementIntoView(el, { block: "bogus" as any, onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: "smooth" });
  });

  it("does not scroll when the element is already visible in the container", () => {
    const { c, el, scrollTo } = yScroller();
    setRect(el, { top: 150, bottom: 200 });
    const result = scrollElementIntoView(el, { block: "start" });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(result).toEqual({ y: c });
  });

  it("block nearest keeps position when visible and forced", () => {
    const { el, scrollTo } = yScroller();
    setRect(el, { top: 150, bottom: 200 });
    scrollElementIntoView(el, { block: "nearest", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenCalledWith({ top: 50, behavior: "smooth" });
  });

  it("block nearest scrolls up / down for elements outside the container", () => {
    const { el, scrollTo } = yScroller();
    setRect(el, { top: 50, bottom: 80 });
    scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });

    setRect(el, { top: 350, bottom: 400 });
    scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 150, behavior: "smooth" });
  });

  it("block nearest picks the smaller move for oversized elements", () => {
    const { el, scrollTo } = yScroller();
    setRect(el, { top: 90, bottom: 330 });
    scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 40, behavior: "smooth" });

    setRect(el, { top: 50, bottom: 310 });
    scrollElementIntoView(el, { block: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 60, behavior: "smooth" });
  });

  it("uses padInView against the container edges", () => {
    const { el, scrollTo } = yScroller();
    setRect(el, { top: 105, bottom: 150 });
    scrollElementIntoView(el, { block: "start", padInView: 10 });
    expect(scrollTo).toHaveBeenCalledWith({ top: 55, behavior: "smooth" });
  });

  it("handles the inline axis inside an x scroll container", () => {
    const { c, el, scrollTo } = makeScroller("x", {
      scrollSize: 2000,
      clientSize: 400,
      scrollPos: 30,
      box: { top: 0, bottom: 100, left: 100, right: 500 },
    });

    setRect(el, { left: 200, right: 300 });
    let result = scrollElementIntoView(el, { inline: "start" });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(result).toEqual({ x: c });

    result = scrollElementIntoView(el, { inline: "start", onlyIfNeeded: false, offsetInline: -5 });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 125, behavior: "smooth" });
    expect(result).toEqual({ x: c });

    scrollElementIntoView(el, { inline: "end", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: -170, behavior: "smooth" });

    scrollElementIntoView(el, { inline: "center", onlyIfNeeded: false });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: -20, behavior: "smooth" });

    setRect(el, { left: 20, right: 60 });
    scrollElementIntoView(el, { inline: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: -50, behavior: "smooth" });

    setRect(el, { left: 600, right: 650 });
    scrollElementIntoView(el, { inline: "nearest" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 180, behavior: "smooth" });
  });
});
