import type { ContentCarouselSlide } from "./content-carousel-slide";
import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

type T_HTMLContentCarouselSlideElement =
  typeof ContentCarouselSlide.CustomElement;

export type ContentCarouselSlideChangedDetail = {
  activeSlide: HTMLElement | null;
  previousSlide: HTMLElement | null;
};

export type ContentCarouselSlideChangedEvent = TEvent & {
  type: "content-carousel-slide-changed";
  detail: ContentCarouselSlideChangedDetail;
};

/** Position of a `<content-carousel>` among its own slides. */
export interface ContentCarouselProvision {
  /** Index of the active slide; `-1` when there are no slides. */
  index: number;
  /** Number of own slides (a nested carousel's slides are not counted). */
  count: number;
  /** Direction of the most recent move; `null` until the first move. */
  lastMove: "forward" | "back" | null;
}

/**
 * Rotates a set of slides — swipe-free, command-driven, auto-play optional.
 * Nav buttons are plain `<button command="--next" commandfor="…">`; fires a
 * change event other elements can react to.
 *
 * `.provision` holds the position (`{ index, count, lastMove }`) so a
 * progress readout can bind to it with `prop("provision")`.
 *
 * @summary Slide rotator — auto-play, manual nav, slide or fade transition.
 *
 * @descendant content-carousel-slide - Slides to rotate through. The first,
 *   or whichever has `is-active`, is shown initially.
 *
 * @command --back - Shows the previous slide (wraps to last). Stops
 *   auto-play.
 * @command --next - Shows the next slide (wraps to first). Stops auto-play.
 *
 * @fires content-carousel-slide-changed - After any slide change, manual or
 *   auto.
 * @type ContentCarouselSlideChangedEvent
 *
 * @example
 * <content-carousel auto-play="5">
 *   <content-carousel-slide is-active>One</content-carousel-slide>
 *   <content-carousel-slide>Two</content-carousel-slide>
 * </content-carousel>
 */
export const ContentCarousel = Neutron({
  tag: "content-carousel",
  props: {
    /**
     * @option
     * Seconds between automatic slide advances. Unset disables auto-play.
     */
    autoPlay: Number,
    /**
     * @option
     * Set when the element is being dragged. Used by CSS only to disable `transition`.
     */
    isScrubbing: Boolean,
    /**
     * @option
     * Transition used when the active slide changes.
     * @values slide | fade
     * @default slide
     */
    slideAnimation: String,
    /**
     * @state
     * Direction of the most recent slide change — drives the CSS
     * animation direction.
     * @values forward | back
     */
    lastMove: String,
    /**
     * @option
     * @state
     * Set automatically after manual navigation, or when the element
     * leaves the document (a DOM move keeps auto-play running), to pause
     * auto-play. Set it directly to pause / resume auto-play
     * programmatically.
     */
    autoPlayStopped: Boolean,
    /**
     * @provision
     * Position: `{ index, count, lastMove }` — the active slide's index
     * among this carousel's own slides, how many there are, and the
     * direction of the last move. Set on connect and after every slide
     * change. Not reflected as an attribute.
     * @type ContentCarouselProvision
     */
    provision: Object as unknown as ConstructorType<ContentCarouselProvision>,
    // private state
    autoPlayIntervalId: Object as unknown as ConstructorType<
      ReturnType<typeof setInterval>
    >,
  },
})
  .defineMethods({
    intervalCallback: () => ({ _move: [false, false] }),
    /** Show the previous / next slide; a manual move stops auto-play. */
    // `any`: `getActiveSlide` is declared in this same call (circular type)
    _move: (element: any, isBack: boolean, isManual: boolean) => {
      const { getActiveSlide, autoPlay } = element;
      const activeSlide =
        getActiveSlide() as T_HTMLContentCarouselSlideElement | null;
      const nextSlide = findSlide(element, activeSlide, isBack);
      nextSlide?.setAttribute?.("is-active", "");
      activeSlide?.removeAttribute("is-active");
      const lastMove = isBack ? "back" : "forward";
      return {
        lastMove,
        ...(isManual && autoPlay ? { autoPlayStopped: true } : {}),
        provision: readProvision(element, lastMove),
        emit: [
          "content-carousel-slide-changed",
          { detail: { activeSlide: nextSlide, previousSlide: activeSlide } },
        ] as any,
      };
    },
    getActiveSlide: (element) => {
      const slides = getOwnSlides(element);
      return {
        // Explicit type: inference hits a circular type issue here
        returns: (slides.find((slide) => slide.hasAttribute("is-active")) ||
          slides[0] ||
          null) as unknown as T_HTMLContentCarouselSlideElement | null,
      };
    },
    /** The current `{ index, count, lastMove }`, read from the DOM. */
    _readProvision: (element) => ({
      returns: readProvision(element, element.lastMove),
    }),
  })
  .onConnected(({ _readProvision }) => ({
    provision: _readProvision() as ContentCarouselProvision,
  }))
  .onPropChanged(
    "autoPlay",
    (
      { autoPlay, autoPlayIntervalId, intervalCallback, autoPlayStopped },
      previous
    ) => {
      if (previous.autoPlay && autoPlayIntervalId) {
        clearInterval(autoPlayIntervalId);
      }
      return {
        autoPlayIntervalId:
          autoPlay && !autoPlayStopped
            ? setInterval(intervalCallback, autoPlay * 1000)
            : null,
      };
    }
  )
  .onDisconnected(
    // A DOM move keeps the interval running; only a real removal stops auto-play
    ({ autoPlay, isMoving }) =>
      !isMoving &&
      autoPlay && {
        autoPlayStopped: true,
      }
  )
  .onPropSet("autoPlayStopped", ({ autoPlayIntervalId }) => {
    if (autoPlayIntervalId || autoPlayIntervalId === 0) {
      clearInterval(autoPlayIntervalId);
      return {
        autoPlayIntervalId: null,
      };
    }
  })
  .onCommand("--back", () => ({ _move: [true, true] }))
  .onCommand("--next", () => ({ _move: [false, true] }));

/** A fresh provision object from the carousel's own slides. */
function readProvision(
  element: HTMLElement,
  lastMove: string | null | undefined
): ContentCarouselProvision {
  const slides = getOwnSlides(element);
  const active =
    slides.find((slide) => slide.hasAttribute("is-active")) || slides[0];
  return {
    index: active ? slides.indexOf(active) : -1,
    count: slides.length,
    lastMove: lastMove === "forward" || lastMove === "back" ? lastMove : null,
  };
}

/**
 * Slides this carousel owns, in document order. A nested carousel keeps
 * its own slides, excluded here the same way `<content-tabs>` scopes
 * headers / bodies.
 */
function getOwnSlides(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll("content-carousel-slide")].filter(
    (slide) => slide.closest("content-carousel") === element
  ) as HTMLElement[];
}

function findSlide(
  element: HTMLElement,
  currentSlide: T_HTMLContentCarouselSlideElement | null,
  isPrevious: boolean
): T_HTMLContentCarouselSlideElement | null {
  if (!currentSlide) return null;
  const slides = getOwnSlides(element);
  const currentIndex = slides.indexOf(currentSlide as unknown as HTMLElement);
  if (currentIndex < 0) return null;
  const nextIndex =
    (currentIndex + (isPrevious ? -1 : 1) + slides.length) % slides.length;
  return slides[nextIndex] as unknown as T_HTMLContentCarouselSlideElement;
}
