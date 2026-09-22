import "@excom/quark-sheet";
import "@excom/content-carousel";
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
import { drag } from "./pointer-utils";

describe("carousel view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("drags the track, snaps to the next slide and clamps at the ends", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "carousel"));
    const handler = root as HTMLGestureHandlerElement;
    const carousel = root.querySelector("content-carousel")!;
    const slides = [...carousel.querySelectorAll("content-carousel-slide")];
    Object.defineProperty(carousel, "offsetWidth", { value: 300 });
    const active = () => slides.findIndex((s) => s.hasAttribute("is-active"));
    expect(active()).toBe(0);
    // first slide: no dragging backwards
    expect(handler.getAttribute("progress-min")).toBe("0");
    expect(handler.getAttribute("progress-max")).toBe("1");

    // drag left two thirds of a slide, let go: snaps to 1 → slide two
    const release = await drag(carousel, { x: 250, y: 50 }, { x: 50, y: 50 });
    await flush();
    expect(carousel.hasAttribute("is-scrubbing")).toBe(true);
    expect(handler.style.getPropertyValue("--gesture-progress")).toBe("0.6667");
    await wait(150);
    release();
    expect(handler.provision?.snap).toBe(1);
    await wait(0); // the settle has nothing to animate here → -snap at once
    await flush();
    expect(handler.style.getPropertyValue("--gesture-progress")).toBe("1");
    expect(active()).toBe(1);
    expect(carousel.hasAttribute("is-scrubbing")).toBe(false);
    expect(handler.getAttribute("progress-min")).toBe("-1");

    // a short drag right snaps back to 0: the slide stays
    const stay = await drag(carousel, { x: 100, y: 50 }, { x: 130, y: 50 });
    await wait(150);
    stay();
    await wait(0);
    await flush();
    expect(active()).toBe(1);

    // drag right past half: previous slide
    const back = await drag(carousel, { x: 50, y: 50 }, { x: 250, y: 50 });
    await wait(150);
    back();
    await wait(0);
    await flush();
    expect(active()).toBe(0);
    expect(handler.getAttribute("progress-min")).toBe("0");
  });
});
