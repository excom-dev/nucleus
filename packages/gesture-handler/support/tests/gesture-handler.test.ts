import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

type PointerInit = {
  id?: number;
  x?: number;
  y?: number;
  pointerType?: string;
  button?: number;
};

const pointerEvent = (type: string, init: PointerInit = {}) =>
  new PointerEvent(type, {
    pointerId: init.id ?? 1,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    pointerType: init.pointerType ?? "touch",
    button: init.button ?? 0,
    bubbles: true,
    cancelable: true,
  });

/** Pointer down targets the surface (or `target`); moves / ups arrive on `window`, as with pointer capture. */
const down = (el: Element, init?: PointerInit, target: Element = el) =>
  target.dispatchEvent(pointerEvent("pointerdown", init));
const move = (init?: PointerInit) =>
  window.dispatchEvent(pointerEvent("pointermove", init));
const up = (init?: PointerInit) =>
  window.dispatchEvent(pointerEvent("pointerup", init));
const cancel = (init?: PointerInit) =>
  window.dispatchEvent(pointerEvent("pointercancel", init));
/** One-finger `touchmove` on `target`; returns the event to read `defaultPrevented`. */
const touchMove = (target: Element, x: number, y: number) => {
  const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  const e = new TouchEvent("touchmove", {
    touches: [touch],
    changedTouches: [touch],
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  return e;
};
/** Resolves after the element's pending animation frame ran. */
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const cssVar = (el: HTMLElement, name: string) =>
  el.style.getPropertyValue(`--gesture-${name}`);

const mount = (attrs = "", inner = "<p>surface</p>") => {
  const el = fixture<HTMLGestureHandlerElement>(
    `<gesture-handler ${attrs}>${inner}</gesture-handler>`
  );
  const events: CustomEvent[] = [];
  const record = (e: Event) => events.push(e as CustomEvent);
  [
    "start",
    "move",
    "end",
    "cancel",
    "swipe",
    "swipe-left",
    "swipe-right",
    "swipe-up",
    "swipe-down",
    "tap",
    "double-tap",
    "long-press",
    "snap",
  ].forEach((name) => el.addEventListener(`gesture-handler-${name}`, record));
  const types = () => events.map((e) => e.type.replace("gesture-handler-", ""));
  const last = (name: string) =>
    [...events].reverse().find((e) => e.type === `gesture-handler-${name}`);
  return { el, events, types, last };
};

/** A recognized single-finger pan of `dx` / `dy`, left down. */
const pan = async (el: Element, dx: number, dy: number) => {
  down(el, { x: 100, y: 100 });
  move({ x: 100 + dx / 2, y: 100 + dy / 2 });
  await frame();
  move({ x: 100 + dx, y: 100 + dy });
  await frame();
};

describe("gesture-handler", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders nothing of its own and starts idle", () => {
    const { el } = mount();
    expect(el).dom.to.equalTag(`<gesture-handler><p>surface</p></gesture-handler>`);
    expect(el.gestureTypes).toEqual(["pan"]);
    expect(el.pointerTypes).toEqual(["touch", "pen"]);
    expect(el.hasAttribute("is-active")).toBe(false);
  });

  it("recognizes a pan past the threshold, writes --gesture-* and announces start / end", async () => {
    const { el, types, last } = mount(`range-px="200"`);
    down(el, { x: 10, y: 10 });
    expect(el.hasAttribute("is-active")).toBe(true);
    expect(el.getAttribute("pointer-count")).toBe("1");
    move({ x: 14, y: 10 });
    await frame();
    // below threshold-px: values are written, nothing recognized
    expect(cssVar(el, "dx")).toBe("4px");
    expect(el.hasAttribute("gesture-type")).toBe(false);
    expect(types()).toEqual([]);

    move({ x: 60, y: 30 });
    await frame();
    expect(el.getAttribute("gesture-type")).toBe("pan");
    expect(el.getAttribute("gesture-direction")).toBe("right");
    expect(cssVar(el, "dx")).toBe("50px");
    expect(cssVar(el, "dy")).toBe("20px");
    expect(cssVar(el, "progress")).toBe("0.25");
    expect(cssVar(el, "range-px")).toBe("200px");
    expect(cssVar(el, "pointers")).toBe("1");
    // derived values are CSS declarations, never written per frame
    expect(cssVar(el, "distance")).toBe("");
    expect(cssVar(el, "progress-px")).toBe("");
    expect(cssVar(el, "angle")).toBe("");
    expect(cssVar(el, "x-ratio")).toBe("");
    expect(types()).toEqual(["start"]);
    const start = last("start")!;
    expect(start.bubbles).toBe(true);
    expect(start.detail.type).toBe("pan");
    expect(start.detail.pointerType).toBe("touch");
    expect(el.provision?.type).toBe("pan");

    up({ x: 60, y: 30 });
    expect(types()).toEqual(["start", "end"]);
    expect(el.hasAttribute("is-active")).toBe(false);
    expect(el.hasAttribute("gesture-type")).toBe(false);
    expect(el.hasAttribute("pointer-count")).toBe(false);
    expect(el.getAttribute("last-gesture")).toBe("pan");
    const end = last("end")!;
    expect(end.cancelable).toBe(true);
    expect(end.detail).toMatchObject({ type: "pan", dx: 50, dy: 20, snap: null, swipe: null });
    expect(el.provision).toEqual(end.detail);
    // values persist after release
    expect(cssVar(el, "dx")).toBe("50px");
  });

  it("only fires -move with should-emit-move", async () => {
    const quiet = mount();
    await pan(quiet.el, 40, 0);
    expect(quiet.types()).toEqual(["start"]);
    up();

    const loud = mount("should-emit-move");
    await pan(loud.el, 40, 0); // recognized on the first frame, one move frame after
    move({ x: 150, y: 100 });
    await frame();
    expect(loud.types()).toEqual(["start", "move", "move"]);
    expect(loud.last("move")!.detail.dx).toBe(50);
  });

  it("ignores mouse unless listed, secondary buttons, and everything while is-disabled", async () => {
    const { el, types } = mount();
    down(el, { pointerType: "mouse" });
    expect(el.hasAttribute("is-active")).toBe(false);

    el.setAttribute("pointer-types", "mouse");
    down(el, { pointerType: "mouse", button: 2 });
    expect(el.hasAttribute("is-active")).toBe(false);
    down(el, { pointerType: "mouse" });
    expect(el.hasAttribute("is-active")).toBe(true);
    up();

    el.setAttribute("is-disabled", "");
    down(el, { pointerType: "mouse" });
    expect(el.hasAttribute("is-active")).toBe(false);
    expect(types()).toEqual([]);
  });

  it("cancels a gesture in progress when is-disabled is set or the browser takes the pointer", async () => {
    const { el, types } = mount();
    await pan(el, 40, 0);
    el.setAttribute("is-disabled", "");
    expect(types()).toEqual(["start", "cancel"]);
    expect(el.hasAttribute("is-active")).toBe(false);
    el.removeAttribute("is-disabled");

    await pan(el, 40, 0);
    cancel({ x: 140, y: 100 });
    expect(types()).toEqual(["start", "cancel", "start", "cancel"]);
    expect(el.provision?.type).toBe("pan");
  });

  it("cancels on a real disconnect and ignores stray pointer ids", async () => {
    const { el, types } = mount();
    await pan(el, 40, 0);
    move({ id: 9, x: 500, y: 500 });
    up({ id: 9 });
    expect(el.hasAttribute("is-active")).toBe(true);
    el.remove();
    await wait(0);
    expect(types()).toEqual(["start", "cancel"]);
  });

  it("fires tap and double-tap for presses that never move", async () => {
    const { el, types, last } = mount(`gesture-types="tap double-tap" double-tap-ms="500"`);
    down(el, { x: 30, y: 40 });
    await frame();
    up({ x: 30, y: 40 });
    expect(types()).toEqual(["tap"]);
    expect(last("tap")!.detail).toEqual({ x: 30, y: 40 });
    expect(el.getAttribute("last-gesture")).toBe("tap");
    down(el, { x: 30, y: 40 });
    up({ x: 30, y: 40 });
    expect(types()).toEqual(["tap", "tap", "double-tap"]);
    expect(el.getAttribute("last-gesture")).toBe("double-tap");
    // the pair is consumed: a third tap starts over
    down(el, { x: 30, y: 40 });
    up({ x: 30, y: 40 });
    expect(types()).toEqual(["tap", "tap", "double-tap", "tap"]);
  });

  it("fires long-press after long-press-ms and then skips the tap", async () => {
    const { el, types } = mount(`gesture-types="tap long-press" long-press-ms="20"`);
    down(el, { x: 5, y: 5 });
    await wait(40);
    expect(types()).toEqual(["long-press"]);
    expect(el.getAttribute("last-gesture")).toBe("long-press");
    up({ x: 5, y: 5 });
    expect(types()).toEqual(["long-press"]);
  });

  it("arm-after=long-press rejects a pan that moves before the hold", async () => {
    const { el, types } = mount(`arm-after="long-press" long-press-ms="20"`);
    await pan(el, 40, 0);
    expect(types()).toEqual([]);
    expect(el.hasAttribute("gesture-type")).toBe(false);
    up();

    down(el, { x: 100, y: 100 });
    await wait(40);
    move({ x: 140, y: 100 });
    await frame();
    expect(types()).toEqual(["start"]);
    expect(el.getAttribute("gesture-type")).toBe("pan");
    up();
    expect(types()).toEqual(["start", "end"]);
  });

  it("pan-x / pan-y only recognize their axis and lock-axis names the dominant one", async () => {
    const x = mount(`gesture-types="pan-x"`);
    await pan(x.el, 0, 40);
    expect(x.types()).toEqual([]);
    up();
    await pan(x.el, 40, 0);
    expect(x.el.getAttribute("gesture-type")).toBe("pan-x");
    up();

    const y = mount(`gesture-types="pan-y"`);
    await pan(y.el, 40, 0);
    expect(y.types()).toEqual([]);
    up();
    await pan(y.el, 0, 40);
    expect(y.el.getAttribute("gesture-type")).toBe("pan-y");
    expect(y.el.getAttribute("gesture-direction")).toBe("down");
    up();

    const locked = mount(`lock-axis`);
    await pan(locked.el, 10, -40);
    expect(locked.el.getAttribute("gesture-type")).toBe("pan-y");
    expect(locked.el.getAttribute("gesture-direction")).toBe("up");
    up();
  });

  it("from-ref and from-edge gate where a gesture may start", async () => {
    const { el } = mount(
      `from-ref="[data-handle]" from-edge="left" edge-px="20"`,
      `<p>body</p><p data-handle>handle</p>`
    );
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 300,
      bottom: 100,
      width: 300,
      height: 100,
    } as DOMRect);
    const [body, handle] = el.querySelectorAll("p");
    down(el, { x: 150, y: 50 }, body);
    expect(el.hasAttribute("is-active")).toBe(false);
    down(el, { x: 150, y: 50 }, handle);
    expect(el.hasAttribute("is-active")).toBe(true);
    // the element's own box is measured once, when the session opens
    expect(cssVar(el, "width")).toBe("300px");
    expect(cssVar(el, "height")).toBe("100px");
    up({ x: 150, y: 50 });
    down(el, { x: 10, y: 50 }, body);
    expect(el.hasAttribute("is-active")).toBe(true);
    up();
  });

  /** A sheet whose own content scrolls: open (`progress-offset="1"`), axis up. */
  const mountHandoff = (attrs = "") => {
    const api = mount(
      `gesture-types="pan-y swipe" progress-axis="up" progress-offset="1"
       range-px="200" handoff-ref="[data-scroller]" ${attrs}`,
      `<div data-scroller><p>content</p></div>`
    );
    const scroller = api.el.querySelector<HTMLElement>("[data-scroller]")!;
    return { ...api, scroller, content: scroller.querySelector("p")! };
  };

  it("handoff-ref hands an overscroll at the top of the scroller to the gesture", async () => {
    const { el, content, types } = mountHandoff();
    await frame();
    // the pointer alone starts nothing: the container may still scroll
    down(el, { x: 100, y: 300 }, content);
    expect(el.hasAttribute("is-active")).toBe(false);
    expect(types()).toEqual([]);

    // first move is downward at scrollTop 0: native scrolling is cancelled
    const first = touchMove(content, 100, 306);
    expect(first.defaultPrevented).toBe(true);
    expect(el.hasAttribute("is-active")).toBe(true);

    // from there it is an ordinary pan, measured from the pointer's origin
    move({ x: 100, y: 400 });
    await frame();
    expect(el.getAttribute("gesture-type")).toBe("pan-y");
    expect(cssVar(el, "dy")).toBe("100px");
    expect(cssVar(el, "progress")).toBe("0.5");
    expect(types()).toEqual(["start"]);
    up({ x: 100, y: 400 });
  });

  it("handoff-ref keeps native scrolling while the scroller can still scroll", async () => {
    const { el, scroller, content } = mountHandoff();
    await frame();
    scroller.scrollTop = 40;
    down(el, { x: 100, y: 300 }, content);
    expect(touchMove(content, 100, 306).defaultPrevented).toBe(false);
    expect(el.hasAttribute("is-active")).toBe(false);
    // the first move decided: reaching the top mid-scroll changes nothing
    scroller.scrollTop = 0;
    expect(touchMove(content, 100, 360).defaultPrevented).toBe(false);
    expect(el.hasAttribute("is-active")).toBe(false);

    // dropping handoff-ref drops its listeners: the scroller is ordinary
    // surface again and a pointer down inside it starts at once
    el.removeAttribute("handoff-ref");
    down(el, { x: 100, y: 300 }, content);
    expect(el.hasAttribute("is-active")).toBe(true);
    up({ x: 100, y: 300 });
  });

  it("handoff-ref ignores a move with no progress left that way, or across the axis", async () => {
    const { el, content } = mountHandoff();
    await frame();
    // upward, but progress-offset is already at progress-max
    down(el, { x: 100, y: 300 }, content);
    expect(touchMove(content, 100, 290).defaultPrevented).toBe(false);
    expect(el.hasAttribute("is-active")).toBe(false);
    // sideways: not along progress-axis
    down(el, { x: 100, y: 300 }, content);
    expect(touchMove(content, 110, 302).defaultPrevented).toBe(false);
    expect(el.hasAttribute("is-active")).toBe(false);
  });

  it("handoff-ref reads the horizontal limit for a horizontal progress-axis", async () => {
    const { el } = mount(
      `gesture-types="pan-x" progress-axis="left" progress-offset="1" range-px="200"
       handoff-ref="[data-scroller]"`,
      `<div data-scroller><p>content</p></div>`
    );
    await frame();
    const scroller = el.querySelector<HTMLElement>("[data-scroller]")!;
    const content = scroller.querySelector("p")!;
    scroller.scrollLeft = 30;
    down(el, { x: 100, y: 100 }, content);
    expect(touchMove(content, 106, 100).defaultPrevented).toBe(false);
    expect(el.hasAttribute("is-active")).toBe(false);

    scroller.scrollLeft = 0;
    down(el, { x: 100, y: 100 }, content);
    expect(touchMove(content, 106, 100).defaultPrevented).toBe(true);
    expect(el.hasAttribute("is-active")).toBe(true);
    up({ x: 106, y: 100 });
  });

  it("handoff-ref starts a mouse drag on the first move, with nothing to prevent", async () => {
    const { el, content } = mountHandoff(`pointer-types="touch mouse"`);
    await frame();
    down(el, { x: 100, y: 300, pointerType: "mouse" }, content);
    const first = pointerEvent("pointermove", {
      x: 100,
      y: 310,
      pointerType: "mouse",
    });
    content.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(false);
    expect(el.hasAttribute("is-active")).toBe(true);
    up({ x: 100, y: 310 });
  });

  it("handoff-ref forgets the start on release, and leaves from-ref starts alone", async () => {
    const { el, content } = mountHandoff(`pointer-types="touch mouse"`);
    await frame();
    down(el, { x: 100, y: 300, pointerType: "mouse" }, content);
    content.dispatchEvent(pointerEvent("pointerup", { x: 100, y: 300, pointerType: "mouse" }));
    const late = pointerEvent("pointermove", { x: 100, y: 330, pointerType: "mouse" });
    content.dispatchEvent(late);
    expect(el.hasAttribute("is-active")).toBe(false);

    // a handle inside the scroller keeps starting on pointerdown
    const handle = mount(
      `gesture-types="pan-y" progress-axis="up" range-px="200"
       handoff-ref="[data-scroller]" from-ref="[data-handle]"`,
      `<div data-scroller><header data-handle>handle</header><p>content</p></div>`
    );
    await frame();
    down(handle.el, { x: 100, y: 100 }, handle.el.querySelector("[data-handle]")!);
    expect(handle.el.hasAttribute("is-active")).toBe(true);
    up();
  });

  it("measures progress along progress-axis from range-ref, offset, bounds and resistance", async () => {
    const { el } = mount(
      `gesture-types="pan-y" progress-axis="up" range-ref="[data-sheet]" progress-offset="1" overshoot-resistance="0.5"`,
      `<div data-sheet></div>`
    );
    Object.defineProperty(el.querySelector("[data-sheet]"), "offsetHeight", { value: 100 });
    await pan(el, 0, 40);
    expect(cssVar(el, "range-px")).toBe("100px");
    expect(cssVar(el, "progress")).toBe("0.6");
    // past progress-min: half of the overshoot
    move({ x: 100, y: 260 });
    await frame();
    expect(cssVar(el, "progress")).toBe("-0.3");
    // past progress-max (offset 100px + 200px up = 300px; 100px over, halved)
    move({ x: 100, y: -100 });
    await frame();
    expect(cssVar(el, "progress")).toBe("2");
    up();
  });

  it("clamps hard without resistance and yields no progress without a range", async () => {
    const clamped = mount(`range-px="50"`);
    await pan(clamped.el, 200, 0);
    expect(cssVar(clamped.el, "progress")).toBe("1");
    expect(cssVar(clamped.el, "range-px")).toBe("50px");
    up({ x: 300, y: 100 });

    const free = mount();
    await pan(free.el, 200, 0);
    expect(cssVar(free.el, "progress")).toBe("0");
    expect(cssVar(free.el, "range-px")).toBe("0px");
    up({ x: 300, y: 100 });
  });

  it("picks the nearest snap point, settles on it and fires -snap", async () => {
    const { el, types, last } = mount(`range-px="100" snap-points="0 0.5 1"`);
    await pan(el, 60, 0);
    await wait(150); // let the velocity window drain: no fling
    up({ x: 160, y: 100 });
    expect(last("end")!.detail.snap).toBe(0.5);
    expect(types()).toEqual(["start", "end"]);
    // nothing to transition here (happy-dom has no getAnimations): -snap
    // lands in the default action's own task
    await wait(0);
    expect(types()).toEqual(["start", "end", "snap"]);
    expect(last("snap")!.detail).toEqual({ value: 0.5, index: 1 });
    expect(cssVar(el, "progress")).toBe("0.5");
  });

  it("waits for the settle transition, and stays quiet when a new gesture cancels it", async () => {
    // the promise is made where the element asks for it, so the rejected one
    // is never briefly unhandled
    const settle = async (finished: () => Promise<unknown>) => {
      const api = mount(`range-px="100" snap-points="0 1"`);
      Object.assign(api.el, {
        getAnimations: () => [
          { transitionProperty: "opacity", finished: Promise.resolve() },
          { transitionProperty: "--gesture-progress", finished: finished() },
        ],
      });
      await pan(api.el, 60, 0);
      await wait(150);
      up({ x: 160, y: 100 });
      await wait(0); // default action, then the transition's own task
      await wait(0);
      return api;
    };

    const landed = await settle(() => Promise.resolve());
    expect(landed.types()).toEqual(["start", "end", "snap"]);
    expect(landed.last("snap")!.detail).toEqual({ value: 1, index: 1 });
    expect(cssVar(landed.el, "progress")).toBe("1");

    const cancelled = await settle(() => Promise.reject(new Error("interrupted")));
    expect(cancelled.types()).toEqual(["start", "end"]);
  });

  it("preventDefault() on -end skips the settle; snap points outside the bounds are ignored", async () => {
    const { el, types, last } = mount(`range-px="100" snap-points="0 1" progress-max="0.5"`);
    el.addEventListener("gesture-handler-end", (e) => e.preventDefault());
    await pan(el, 40, 0);
    up({ x: 140, y: 100 });
    expect(last("end")!.detail.snap).toBe(0);
    await wait(40);
    expect(types()).toEqual(["start", "end"]);
    expect(cssVar(el, "progress")).toBe("0.4");
  });

  it("recognizes a swipe from release velocity and snaps in its direction", async () => {
    const { el, types, last } = mount(
      `gesture-types="pan-x swipe" range-px="1000" snap-points="0 0.5 1"`
    );
    await pan(el, 40, 0);
    move({ x: 200, y: 100 });
    await wait(2);
    up({ x: 200, y: 100 });
    expect(types().slice(0, 3)).toEqual(["start", "swipe", "swipe-right"]);
    expect(last("swipe")!.detail.direction).toBe("right");
    expect(last("swipe")!.detail.velocity).toBeGreaterThan(0.5);
    expect(el.getAttribute("last-gesture")).toBe("swipe-right");
    // progress is 0.1: a fling forward snaps to the next point, not the nearest
    expect(last("end")!.detail).toMatchObject({ swipe: "right", snap: 0.5 });
  });

  it("filters swipes by swipe-directions and by the pan axis", async () => {
    const { el, types, last } = mount(`gesture-types="pan swipe" swipe-directions="left"`);
    await pan(el, 40, 0);
    move({ x: 200, y: 100 });
    await wait(2);
    up({ x: 200, y: 100 });
    expect(types()).toEqual(["start", "end"]);
    expect(last("end")!.detail.swipe).toBeNull();

    const axis = mount(`gesture-types="pan-x swipe"`);
    await pan(axis.el, 40, 4);
    move({ x: 141, y: 300 });
    await wait(2);
    up({ x: 141, y: 300 });
    expect(axis.types()).toEqual(["start", "end"]);
  });

  it("tracks pinch and rotate with two pointers and keeps going when one lifts", async () => {
    const { el, types, last } = mount(`gesture-types="pinch rotate"`);
    down(el, { id: 1, x: 100, y: 100 });
    down(el, { id: 2, x: 200, y: 100 });
    down(el, { id: 3, x: 300, y: 300 }); // beyond max-pointers
    expect(el.getAttribute("pointer-count")).toBe("2");
    await frame();
    expect(types()).toEqual(["start"]);
    expect(el.getAttribute("gesture-type")).toBe("pinch");
    expect(last("start")!.detail.pointers).toBe(2);

    move({ id: 2, x: 300, y: 100 });
    await frame();
    expect(cssVar(el, "scale")).toBe("2");
    expect(cssVar(el, "rotate")).toBe("0deg");
    move({ id: 2, x: 100, y: 300 });
    await frame();
    expect(cssVar(el, "scale")).toBe("2");
    expect(cssVar(el, "rotate")).toBe("90deg");

    up({ id: 2, x: 100, y: 300 });
    expect(el.getAttribute("pointer-count")).toBe("1");
    expect(el.hasAttribute("is-active")).toBe(true);
    await frame();
    expect(cssVar(el, "scale")).toBe("2");
    up({ id: 1, x: 100, y: 100 });
    expect(types()).toEqual(["start", "end"]);
    expect(last("end")!.detail.type).toBe("pinch");
  });

  it("a second finger can still start a pinch after a rejected single-finger move", async () => {
    const { el, types } = mount(`gesture-types="pinch"`);
    await pan(el, 40, 0);
    expect(types()).toEqual([]);
    down(el, { id: 2, x: 200, y: 200 });
    await frame();
    expect(types()).toEqual(["start"]);
    up({ id: 1 });
    up({ id: 2 });
  });

  it("pointer capture starts at recognition so taps stay native, and a pointer joining mid-pan keeps travel continuous", async () => {
    const { el } = mount(`gesture-types="pan pinch"`);
    const capture = vi.spyOn(el, "setPointerCapture").mockImplementation(() => {
      throw new Error("no such pointer");
    });
    down(el, { id: 1, x: 100, y: 100 });
    expect(capture).not.toHaveBeenCalled();
    move({ id: 1, x: 150, y: 100 });
    await frame();
    expect(capture).toHaveBeenCalledWith(1);
    down(el, { id: 2, x: 250, y: 100 });
    expect(capture).toHaveBeenCalledWith(2);
    await frame();
    // centroid jumped to x=200, travel stays 50
    expect(cssVar(el, "dx")).toBe("50px");
    expect(cssVar(el, "pointers")).toBe("2");
    up({ id: 1 });
    up({ id: 2 });
  });

  it("recognizes a flick that starts and ends within one frame", async () => {
    const { el, types, last } = mount(`gesture-types="pan-x swipe"`);
    down(el, { x: 100, y: 100 });
    move({ x: 160, y: 100 });
    await wait(2);
    up({ x: 160, y: 100 });
    expect(types()).toEqual(["start", "swipe", "swipe-right", "end"]);
    expect(last("end")!.detail.type).toBe("pan-x");
    expect(el.getAttribute("last-gesture")).toBe("swipe-right");
    expect(el.hasAttribute("is-active")).toBe(false);
  });
});
