import { ConstructorType, Neutron } from "@excom/neutron";

/**
 * A single slide within `<content-carousel>`.
 *
 * @summary One rotating slide of a content-carousel.
 */
export const ContentCarouselSlide = Neutron({
  tag: "content-carousel-slide",
  props: {
    /**
     * @option
     * @state
     * Marks this as the currently shown slide. The parent
     * `<content-carousel>` keeps exactly one slide active. Write it directly
     * (a swipe) and the carousel's `provision`, `last-move` and
     * slide-changed event follow.
     */
    isActive: Boolean,
    // private state
    _parentCarousel: {
      type: HTMLElement as unknown as ConstructorType<HTMLContentCarouselElement>,
      store: "weak",
    },
  },
})
  .defineMethods({
    _notifyCarousel: ({ _parentCarousel }) => {
      _parentCarousel?._queueSync?.();
    },
  })
  .onConnected((el) => [
    { _parentCarousel: el.closest("content-carousel") },
    { _notifyCarousel: [] },
  ])
  .onPropChanged("isActive", () => ({ _notifyCarousel: [] }))
  // Held until now: a detached slide cannot `closest()` its carousel
  .onDisconnected(() => [{ _notifyCarousel: [] }, { _parentCarousel: null }]);
