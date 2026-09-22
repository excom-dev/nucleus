import "@excom/quark-sheet";
import "@excom/content-drawer";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  flush,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";
import { drag, frame, pull } from "./pointer-utils";

describe("sheet view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("scrubs the bottom sheet open and closed, committing on gesture-handler-end", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "sheet"));
    const handler = root as HTMLGestureHandlerElement;
    const drawer = root.querySelector("content-drawer")!;
    const header = drawer.querySelector("header")!;
    // happy-dom has no layout: give the drawer the height range-ref measures
    Object.defineProperty(drawer, "offsetHeight", { value: 200 });
    expect(handler.getAttribute("progress-offset")).toBe("0");
    expect(drawer.hasAttribute("is-open")).toBe(false);

    // a pointer down elsewhere than the header never starts
    root.querySelector("button")!.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, pointerType: "touch", bubbles: true })
    );
    expect(handler.hasAttribute("is-active")).toBe(false);

    // drag the header up three quarters of the way, no fling
    const release = await drag(header, { x: 100, y: 300 }, { x: 100, y: 150 });
    await flush();
    expect(handler.getAttribute("gesture-type")).toBe("pan-y");
    expect(handler.style.getPropertyValue("--gesture-progress")).toBe("0.75");
    expect(drawer.hasAttribute("is-scrubbing")).toBe(true);
    await wait(150);
    release();
    expect(handler.provision?.snap).toBe(1);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    expect(drawer.hasAttribute("is-scrubbing")).toBe(false);
    expect(handler.getAttribute("progress-offset")).toBe("1");

    // open: dragging down starts from 1 and a short drag snaps back to open
    const stay = await drag(header, { x: 100, y: 100 }, { x: 100, y: 130 });
    await frame();
    expect(handler.style.getPropertyValue("--gesture-progress")).toBe("0.85");
    await wait(150);
    stay();
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);

    // a long drag down closes it
    const close = await drag(header, { x: 100, y: 100 }, { x: 100, y: 260 });
    await wait(150);
    close();
    expect(handler.provision?.snap).toBe(0);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
    expect(drawer.hasAttribute("is-scrubbing")).toBe(false);
    expect(handler.getAttribute("progress-offset")).toBe("0");
  });

  it("closes the open sheet by pulling its own content past the top (handoff-ref)", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "sheet"));
    const handler = root as HTMLGestureHandlerElement;
    const drawer = root.querySelector("content-drawer")!;
    const header = drawer.querySelector("header")!;
    const body = drawer.querySelector("p")!;
    Object.defineProperty(drawer, "offsetHeight", { value: 200 });

    // open it from the grab handle first
    const open = await drag(header, { x: 100, y: 300 }, { x: 100, y: 150 });
    await wait(150);
    open();
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(true);
    expect(handler.getAttribute("progress-offset")).toBe("1");

    // scrolled content keeps scrolling: nothing is taken over
    drawer.scrollTop = 50;
    const scrolled = await pull(body, { x: 100, y: 100 }, { x: 100, y: 200 });
    await flush();
    expect(scrolled.first.defaultPrevented).toBe(false);
    expect(handler.hasAttribute("is-active")).toBe(false);
    expect(drawer.hasAttribute("is-scrubbing")).toBe(false);

    // back at the top, the same pull becomes the drag and closes the sheet
    drawer.scrollTop = 0;
    const handoff = await pull(body, { x: 100, y: 100 }, { x: 100, y: 260 });
    await flush();
    expect(handoff.first.defaultPrevented).toBe(true);
    expect(handler.getAttribute("gesture-type")).toBe("pan-y");
    expect(handler.style.getPropertyValue("--gesture-progress")).toBe("0.2");
    expect(drawer.hasAttribute("is-scrubbing")).toBe(true);
    await wait(150);
    handoff.release();
    expect(handler.provision?.snap).toBe(0);
    await flush();
    expect(drawer.hasAttribute("is-open")).toBe(false);
    expect(drawer.hasAttribute("is-scrubbing")).toBe(false);
  });
});
