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
 * @fires content-carousel-slide-changed - After any slide change: a command,
 *   auto-play, or `is-active` moved from one slide to another (a swipe).
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
     * @values slide | fade | track
     * @default slide
     */
    slideAnimation: String,
    /**
     * @state
     * Direction of the most recent slide change — drives the CSS
     * animation direction. `is-active` moved from one slide to another
     * counts as `forward` / `back` by position. Unset until the first move,
     * so the initial slide appears without animating in.
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
     * direction of the last move. Set on connect and after every change,
     * including slides added / removed and `is-active` written on a slide.
     * Not reflected as an attribute.
     * @type ContentCarouselProvision
     */
    provision: Object as unknown as ConstructorType<ContentCarouselProvision>,
    // private state
    _autoPlayIntervalId: {
      type: Object as unknown as ConstructorType<
        ReturnType<typeof setInterval>
      >,
      attr: false,
    },
    _activeSlide: { type: HTMLElement, store: "weak" },
    _syncQueued: { type: Boolean, attr: false },
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
        _activeSlide: nextSlide,
        ...(isManual && autoPlay ? { autoPlayStopped: true } : {}),
        provision: readProvision(getOwnSlides(element), lastMove),
        emit: [
          "content-carousel-slide-changed",
          { detail: { activeSlide: nextSlide, previousSlide: activeSlide } },
        ] as any,
      };
    },
    getActiveSlide: (element) => ({
      // Explicit type: inference hits a circular type issue here
      returns: activeOf(
        getOwnSlides(element)
      ) as unknown as T_HTMLContentCarouselSlideElement | null,
    }),
    /**
     * Re-read the own slides: after connect, and after a slide connected,
     * disconnected or changed `is-active`. `is-active` passing from one slide
     * to another is a move; the first-slide fallback never is. Assigns only
     * what changed.
     */
    _sync: (element) => {
      const { _activeSlide: previousSlide, lastMove, provision } = element;
      const slides = getOwnSlides(element);
      const activeSlide = slides.find(hasIsActive) || null;
      const isMove =
        !!previousSlide && !!activeSlide && activeSlide !== previousSlide;
      const move = !isMove
        ? lastMove
        : slides.indexOf(activeSlide) < slides.indexOf(previousSlide)
          ? "back"
          : "forward";
      const next = readProvision(slides, move);
      return {
        _syncQueued: false,
        _activeSlide: activeSlide,
        ...(isMove
          ? {
              lastMove: move,
              emit: [
                "content-carousel-slide-changed",
                { detail: { activeSlide, previousSlide } },
              ] as any,
            }
          : {}),
        ...(isSameProvision(provision, next) ? {} : { provision: next }),
      };
    },
  })
  .defineMethods({
    /** Called by slides; batches their changes into one re-read. */
    _queueSync: ({ _syncQueued, _sync }) => {
      if (!_syncQueued) {
        queueMicrotask(_sync);
        return { _syncQueued: true };
      }
    },
  })
  .onConnected(() => ({ _sync: [] }))
  .onPropChanged(
    "autoPlay",
    (
      { autoPlay, _autoPlayIntervalId, intervalCallback, autoPlayStopped },
      previous
    ) => {
      if (previous.autoPlay && _autoPlayIntervalId) {
        clearInterval(_autoPlayIntervalId);
      }
      return {
        _autoPlayIntervalId:
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
  .onPropSet("autoPlayStopped", ({ _autoPlayIntervalId }) => {
    if (_autoPlayIntervalId || _autoPlayIntervalId === 0) {
      clearInterval(_autoPlayIntervalId);
      return {
        _autoPlayIntervalId: null,
      };
    }
  })
  .onCommand("--back", () => ({ _move: [true, true] }))
  .onCommand("--next", () => ({ _move: [false, true] }));

const hasIsActive = (slide: HTMLElement) => slide.hasAttribute("is-active");

/** The `is-active` slide, else the first; `null` without slides. */
const activeOf = (slides: HTMLElement[]) =>
  slides.find(hasIsActive) || slides[0] || null;

/** A fresh provision object from the carousel's own slides. */
function readProvision(
  slides: HTMLElement[],
  lastMove: string | null | undefined
): ContentCarouselProvision {
  const active = activeOf(slides);
  return {
    index: active ? slides.indexOf(active) : -1,
    count: slides.length,
    lastMove: lastMove === "forward" || lastMove === "back" ? lastMove : null,
  };
}

const isSameProvision = (
  a: ContentCarouselProvision | null | undefined,
  b: ContentCarouselProvision
) =>
  !!a &&
  a.index === b.index &&
  a.count === b.count &&
  a.lastMove === b.lastMove;

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
