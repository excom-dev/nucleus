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
import { invokeCommand } from "@excom/neutron";

/**
 * Auto-play ticks are real timers; on a loaded runner a 40–50 ms interval can
 * fire after a fixed `wait(80)`, so poll for the final state instead.
 */
const expectActiveSlide = (carousel: HTMLContentCarouselElement, slide: Element) =>
  vi.waitFor(() => expect(carousel.getActiveSlide()).toBe(slide), { timeout: 2000 });

/** Invoke a command and let the handler's microtask run. */
const command = async (el: Element, name: string) => {
  invokeCommand(el, name);
  await Promise.resolve();
};
import type { ContentCarouselSlideChangedDetail } from "../../content-carousel";

describe("content-carousel-slide", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("has isActive boolean", async () => {
    const slide = fixture<HTMLContentCarouselSlideElement>(
      `<content-carousel-slide></content-carousel-slide>`,
    );
    expect(slide).dom.to.equalTag(
      `<content-carousel-slide></content-carousel-slide>`,
    );
    slide.setAttribute("is-active", "");
    expect(slide).dom.to.equalTag(
      `<content-carousel-slide is-active></content-carousel-slide>`,
    );
  });
});

describe("content-carousel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("defaults to first slide if no slides are active", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const firstSlide = carousel.querySelector("content-carousel-slide");
    expect(carousel.getActiveSlide()).to.equal(firstSlide);
  });

  it("auto-plays", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel auto-play="0.1">
        <content-carousel-slide></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const firstSlide = carousel.getActiveSlide();
    await wait(101);
    const secondSlide = carousel.getActiveSlide();
    expect(firstSlide?.localName).to.equal("content-carousel-slide");
    expect(secondSlide?.localName).to.equal("content-carousel-slide");
    expect(secondSlide).not.to.equal(firstSlide);
  });

  it("navigates", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide></content-carousel-slide>
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const secondSlide = carousel.getActiveSlide()!;
    await command(carousel, "--next");
    expect(secondSlide).dom.to.equalTag(
      `<content-carousel-slide></content-carousel-slide>`,
    );
    expect(carousel.getActiveSlide()).not.to.equal(secondSlide);
    expect(secondSlide.nextElementSibling).dom.to.equalTag(
      `<content-carousel-slide is-active></content-carousel-slide>`,
    );
    await command(carousel, "--back");
    expect(secondSlide).dom.to.equalTag(
      `<content-carousel-slide is-active></content-carousel-slide>`,
    );
  });

  it("stops auto-play on manual navigation", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel auto-play="0.1">
        <content-carousel-slide></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const firstSlide = carousel.querySelectorAll("content-carousel-slide")[0]!;
    const secondSlide = carousel.querySelectorAll("content-carousel-slide")[1]!;
    await command(carousel, "--next");
    await wait(105);
    expect(carousel.getActiveSlide()).to.equal(secondSlide);
    expect(firstSlide).dom.to.equalTag(
      `<content-carousel-slide></content-carousel-slide>`,
    );
    expect(secondSlide).dom.to.equalTag(
      `<content-carousel-slide is-active></content-carousel-slide>`,
    );
    expect(carousel).dom.to.equalTag(
      `<content-carousel auto-play="0.1" auto-play-stopped last-move="forward"></content-carousel>`,
    );
  });
});

describe("content-carousel (navigation edge cases)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const build = (attrs = "", active = 0) =>
    fixture<HTMLContentCarouselElement>(
      `<content-carousel ${attrs}>
        <content-carousel-slide ${active === 0 ? "is-active" : ""}></content-carousel-slide>
        <content-carousel-slide ${active === 1 ? "is-active" : ""}></content-carousel-slide>
        <content-carousel-slide ${active === 2 ? "is-active" : ""}></content-carousel-slide>
      </content-carousel>`,
    );

  it("wraps from the last slide to the first on next", async () => {
    const carousel = build("", 2);
    const slides = carousel.querySelectorAll("content-carousel-slide");
    await command(carousel, "--next");
    expect(carousel.getActiveSlide()).toBe(slides[0]);
    expect(slides[2].hasAttribute("is-active")).toBe(false);
    expect(carousel).dom.to.equalTag(
      `<content-carousel last-move="forward"></content-carousel>`,
    );
  });

  it("wraps from the first slide to the last on back", async () => {
    const carousel = build("", 0);
    const slides = carousel.querySelectorAll("content-carousel-slide");
    await command(carousel, "--back");
    expect(carousel.getActiveSlide()).toBe(slides[2]);
    expect(slides[0].hasAttribute("is-active")).toBe(false);
    expect(carousel).dom.to.equalTag(
      `<content-carousel last-move="back"></content-carousel>`,
    );
  });

  it("fires content-carousel-slide-changed with the new and previous slides", async () => {
    const carousel = build("", 1);
    const slides = carousel.querySelectorAll("content-carousel-slide");
    const details: ContentCarouselSlideChangedDetail[] = [];
    carousel.addEventListener("content-carousel-slide-changed", (e) => {
      details.push((e as CustomEvent).detail);
    });
    await command(carousel, "--next");
    await command(carousel, "--back");
    expect(details).toEqual([
      { activeSlide: slides[2], previousSlide: slides[1] },
      { activeSlide: slides[1], previousSlide: slides[2] },
    ]);
  });

  it("stops navigation events from bubbling past the carousel", async () => {
    const wrapper = fixture<HTMLDivElement>(
      `<div>
        <content-carousel>
          <content-carousel-slide is-active></content-carousel-slide>
          <content-carousel-slide></content-carousel-slide>
        </content-carousel>
      </div>`,
    );
    const seen = vi.fn();
    wrapper.addEventListener("command", seen);
    invokeCommand(wrapper.querySelector("content-carousel")!, "--next");
    expect(seen).not.toHaveBeenCalled();
  });

  it("does nothing useful without slides", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel></content-carousel>`,
    );
    const details: ContentCarouselSlideChangedDetail[] = [];
    carousel.addEventListener("content-carousel-slide-changed", (e) => {
      details.push((e as CustomEvent).detail);
    });
    expect(carousel.getActiveSlide()).toBe(null);
    await command(carousel, "--next");
    expect(details).toEqual([{ activeSlide: null, previousSlide: null }]);
    expect(carousel).dom.to.equalTag(
      `<content-carousel last-move="forward"></content-carousel>`,
    );
  });

  it("does not mark auto-play stopped on manual navigation when auto-play is unset", async () => {
    const carousel = build("", 0);
    await command(carousel, "--next");
    expect(carousel.autoPlayStopped).toBe(false);
    expect(carousel.autoPlayIntervalId).toBe(null);
  });
});

describe("content-carousel (provision)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const build = (active = 0) =>
    fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide ${active === 0 ? "is-active" : ""}></content-carousel-slide>
        <content-carousel-slide ${active === 1 ? "is-active" : ""}></content-carousel-slide>
        <content-carousel-slide ${active === 2 ? "is-active" : ""}></content-carousel-slide>
      </content-carousel>`,
    );

  it("reads the initial position on connect", async () => {
    const carousel = build(1);
    expect(carousel.provision).toEqual({ index: 1, count: 3, lastMove: null });
  });

  it("defaults to the first slide when none is active", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    expect(carousel.provision).toEqual({ index: 0, count: 2, lastMove: null });
  });

  it("reports -1 / 0 without slides", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel></content-carousel>`,
    );
    expect(carousel.provision).toEqual({ index: -1, count: 0, lastMove: null });
  });

  it("updates after next, back and wrap-around, alongside slide-changed", async () => {
    const carousel = build(1);
    const provisionSpy = vi.fn();
    const changedSpy = vi.fn();
    carousel.addEventListener("neutron-provision", provisionSpy);
    carousel.addEventListener("content-carousel-slide-changed", changedSpy);

    await command(carousel, "--next");
    expect(carousel.provision).toEqual({
      index: 2,
      count: 3,
      lastMove: "forward",
    });

    // wrap forward
    await command(carousel, "--next");
    expect(carousel.provision).toEqual({
      index: 0,
      count: 3,
      lastMove: "forward",
    });

    // wrap back
    await command(carousel, "--back");
    expect(carousel.provision).toEqual({ index: 2, count: 3, lastMove: "back" });

    expect(provisionSpy).toHaveBeenCalledTimes(3);
    expect(changedSpy).toHaveBeenCalledTimes(3);
    expect(carousel).dom.to.equalTag(
      `<content-carousel last-move="back"></content-carousel>`,
    );
  });

  it("assigns a new object on every move", async () => {
    const carousel = build(0);
    const before = carousel.provision;
    await command(carousel, "--next");
    expect(carousel.provision).not.toBe(before);
    expect(before).toEqual({ index: 0, count: 3, lastMove: null });
  });

  it("counts only its own slides when carousels nest", async () => {
    const outer = fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide>
          <content-carousel>
            <content-carousel-slide></content-carousel-slide>
            <content-carousel-slide is-active></content-carousel-slide>
          </content-carousel>
        </content-carousel-slide>
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const inner = outer.querySelector<HTMLContentCarouselElement>(
      "content-carousel",
    )!;
    expect(outer.provision).toEqual({ index: 1, count: 3, lastMove: null });
    expect(inner.provision).toEqual({ index: 1, count: 2, lastMove: null });

    await command(inner, "--next");
    expect(inner.provision).toEqual({ index: 0, count: 2, lastMove: "forward" });
    expect(outer.provision).toEqual({ index: 1, count: 3, lastMove: null });

    await command(outer, "--back");
    expect(outer.provision).toEqual({ index: 0, count: 3, lastMove: "back" });
    expect(inner.provision).toEqual({ index: 0, count: 2, lastMove: "forward" });
  });
});

describe("content-carousel (auto-play lifecycle)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("re-creates the interval when auto-play changes and drops it when unset", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel auto-play="10">
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const firstId = carousel.autoPlayIntervalId;
    expect(firstId).not.toBe(null);
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    carousel.autoPlay = 0.05;
    expect(clearSpy).toHaveBeenCalledWith(firstId);
    const secondId = carousel.autoPlayIntervalId;
    expect(secondId).not.toBe(null);
    expect(secondId).not.toBe(firstId);
    const slides = carousel.querySelectorAll("content-carousel-slide");
    await expectActiveSlide(carousel, slides[1]);

    carousel.autoPlay = null;
    expect(clearSpy).toHaveBeenCalledWith(secondId);
    expect(carousel.autoPlayIntervalId).toBe(null);
    await wait(80);
    expect(carousel.getActiveSlide()).toBe(slides[1]);
  });

  it("does not start the interval when auto-play-stopped is preset", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel auto-play="0.05" auto-play-stopped>
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const slides = carousel.querySelectorAll("content-carousel-slide");
    expect(carousel.autoPlayIntervalId).toBe(null);
    await wait(80);
    expect(carousel.getActiveSlide()).toBe(slides[0]);
  });

  it("pauses via auto-play-stopped and resumes when it is unset", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel auto-play="0.05">
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const slides = carousel.querySelectorAll("content-carousel-slide");
    carousel.autoPlayStopped = true;
    expect(carousel.autoPlayIntervalId).toBe(null);
    await wait(80);
    expect(carousel.getActiveSlide()).toBe(slides[0]);
    carousel.autoPlayStopped = false;
    // unsetting the flag alone does not restart; a new auto-play value does
    expect(carousel.autoPlayIntervalId).toBe(null);
    carousel.autoPlay = 0.04;
    expect(carousel.autoPlayIntervalId).not.toBe(null);
    await expectActiveSlide(carousel, slides[1]);
  });

  it("tolerates auto-play-stopped without an interval", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide is-active></content-carousel-slide>
      </content-carousel>`,
    );
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    carousel.autoPlayStopped = true;
    expect(clearSpy).not.toHaveBeenCalled();
    expect(carousel.autoPlayIntervalId).toBe(null);
    expect(carousel).dom.to.equalTag(
      `<content-carousel auto-play-stopped></content-carousel>`,
    );
  });

  it("stops auto-play on disconnect", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel auto-play="0.05">
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const slides = carousel.querySelectorAll("content-carousel-slide");
    expect(carousel.autoPlayIntervalId).not.toBe(null);
    carousel.remove();
    await wait(0);
    expect(carousel.autoPlayStopped).toBe(true);
    expect(carousel.autoPlayIntervalId).toBe(null);
    await wait(80);
    expect(carousel.getActiveSlide()).toBe(slides[0]);
  });

  it("leaves auto-play-stopped alone on disconnect when auto-play is unset", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide is-active></content-carousel-slide>
      </content-carousel>`,
    );
    carousel.remove();
    await wait(0);
    expect(carousel.autoPlayStopped).toBe(false);
  });

  it("keeps auto-play running when moved between parents", async () => {
    const carousel = fixture<HTMLContentCarouselElement>(
      `<content-carousel auto-play="0.05">
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const slides = carousel.querySelectorAll("content-carousel-slide");
    const intervalId = carousel.autoPlayIntervalId;
    expect(intervalId).not.toBe(null);
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const other = document.createElement("div");
    document.body.append(other);
    other.append(carousel);
    await wait(0);

    // a synchronous re-parent is a move, not a removal
    expect(carousel.autoPlayStopped).toBe(false);
    expect(carousel.autoPlayIntervalId).toBe(intervalId);
    expect(clearSpy).not.toHaveBeenCalled();
    await expectActiveSlide(carousel, slides[1]);
  });
});

describe("content-carousel (nested carousels)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const nestedFixture = () => {
    const outer = fixture<HTMLContentCarouselElement>(
      `<content-carousel>
        <content-carousel-slide>
          <content-carousel>
            <content-carousel-slide></content-carousel-slide>
            <content-carousel-slide is-active></content-carousel-slide>
          </content-carousel>
        </content-carousel-slide>
        <content-carousel-slide is-active></content-carousel-slide>
        <content-carousel-slide></content-carousel-slide>
      </content-carousel>`,
    );
    const inner = outer.querySelector<HTMLContentCarouselElement>(
      "content-carousel",
    )!;
    const outerSlides = [...outer.children].filter(
      (child) => child.localName === "content-carousel-slide",
    );
    const innerSlides = [...inner.children];
    return { outer, inner, outerSlides, innerSlides };
  };

  it("resolves each carousel's active slide from its own slides", async () => {
    const { outer, inner, outerSlides, innerSlides } = nestedFixture();
    expect(outer.getActiveSlide()).toBe(outerSlides[1]);
    expect(inner.getActiveSlide()).toBe(innerSlides[1]);
  });

  it("--next on the outer only changes outer slides", async () => {
    const { outer, inner, outerSlides, innerSlides } = nestedFixture();
    const spy = vi.fn();
    outer.addEventListener("content-carousel-slide-changed", spy);

    await command(outer, "--next");

    expect(outer.getActiveSlide()).toBe(outerSlides[2]);
    expect(outerSlides[1].hasAttribute("is-active")).toBe(false);
    expect(inner.getActiveSlide()).toBe(innerSlides[1]);
    expect(innerSlides[0].hasAttribute("is-active")).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      (spy.mock.calls[0][0] as CustomEvent<ContentCarouselSlideChangedDetail>)
        .detail,
    ).toEqual({ activeSlide: outerSlides[2], previousSlide: outerSlides[1] });
  });

  it("--back on the outer wraps within the outer's own slides", async () => {
    const { outer, inner, outerSlides, innerSlides } = nestedFixture();
    outerSlides[1].removeAttribute("is-active");
    outerSlides[0].setAttribute("is-active", "");

    await command(outer, "--back");

    expect(outer.getActiveSlide()).toBe(outerSlides[2]);
    expect(outerSlides[0].hasAttribute("is-active")).toBe(false);
    expect(inner.getActiveSlide()).toBe(innerSlides[1]);
  });

  it("navigating the inner carousel leaves the outer untouched", async () => {
    const { outer, inner, outerSlides, innerSlides } = nestedFixture();
    const spy = vi.fn();
    outer.addEventListener("content-carousel-slide-changed", spy);

    await command(inner, "--next");

    expect(inner.getActiveSlide()).toBe(innerSlides[0]);
    expect(innerSlides[1].hasAttribute("is-active")).toBe(false);
    expect(outer.getActiveSlide()).toBe(outerSlides[1]);
    // the inner change bubbles to the outer listener, but the outer's own
    // slides never changed
    expect(outerSlides.map((slide) => slide.hasAttribute("is-active"))).toEqual(
      [false, true, false],
    );
  });
});
