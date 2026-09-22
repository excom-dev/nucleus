import { Neutron } from "@excom/neutron";

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
     * `<content-carousel>` keeps exactly one slide active.
     */
    isActive: Boolean,
  },
});
