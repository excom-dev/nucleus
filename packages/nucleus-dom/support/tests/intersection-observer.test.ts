import { afterEach, describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, type Dom, whenIdle } from "../../index";

let dom: Dom;
const open = (intersectAll = true) => {
  dom = createDom({ intersectAll, html: `<p id="a"></p><p id="b"></p><p id="c"></p>` });
  return dom.window;
};
const $ = (id: string) => dom.document.getElementById(id)!;
/** The `[id, isIntersecting, intersectionRatio]` of each callback's entries. */
const seen = (callback: ReturnType<typeof vi.fn>) =>
  callback.mock.calls.map(([entries]) =>
    (entries as IntersectionObserverEntry[]).map(({ target, isIntersecting, intersectionRatio }) => [
      target.id,
      isIntersecting,
      intersectionRatio,
    ]),
  );

afterEach(() => dom.dispose());

describe("createDom({ intersectAll })", () => {
  it("reports observed elements intersecting a frame later, in one batch", async () => {
    const window = open();
    const callback = vi.fn();
    const observer = new window.IntersectionObserver(callback);
    observer.observe($("a"));
    observer.observe($("b"));
    observer.observe($("a"));
    expect(callback).not.toHaveBeenCalled();
    await whenIdle(window);
    expect(seen(callback)).toEqual([
      [
        ["a", true, 1],
        ["b", true, 1],
      ],
    ]);
    const [[[entry], self]] = callback.mock.calls as [[IntersectionObserverEntry[], IntersectionObserver]];
    expect(self).toBe(observer);
    expect(entry.rootBounds!.width).toBe(window.innerWidth);
    expect(entry).toBeInstanceOf(window.IntersectionObserverEntry);
  });

  it("reports a detached target out of view, and drops unobserved and disconnected ones", async () => {
    const window = open();
    const callback = vi.fn();
    const observer = new window.IntersectionObserver(callback);
    $("c").remove();
    for (const id of ["a", "b", "c"]) observer.observe(id === "c" ? dom.window.document.createElement("p") : $(id));
    observer.unobserve($("b"));
    await whenIdle(window);
    expect(seen(callback)).toEqual([
      [
        ["a", true, 1],
        ["", false, 0],
      ],
    ]);
    observer.observe($("b"));
    observer.disconnect();
    await whenIdle(window);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("hands queued entries to takeRecords() and keeps its options", async () => {
    const window = open();
    const callback = vi.fn();
    const observer = new window.IntersectionObserver(callback, { rootMargin: "500px", threshold: [1, 0.25] });
    observer.observe($("a"));
    expect(observer.takeRecords().map(({ target }) => target.id)).toEqual(["a"]);
    await whenIdle(window);
    expect(callback).not.toHaveBeenCalled();
    expect([observer.root, observer.rootMargin, observer.thresholds]).toEqual([null, "500px", [0.25, 1]]);
    expect(new window.IntersectionObserver(callback).thresholds).toEqual([0]);
  });

  it("keeps happy-dom's silent observer by default", async () => {
    const window = open(false);
    const callback = vi.fn();
    new window.IntersectionObserver(callback).observe($("a"));
    await whenIdle(window);
    expect(callback).not.toHaveBeenCalled();
  });
});
