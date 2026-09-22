import { ContentCarousel } from "./content-carousel";
import { ContentCarouselSlide } from "./content-carousel-slide";

ContentCarousel.define();
ContentCarouselSlide.define();

export { ContentCarousel, ContentCarouselSlide };

type T_HTMLContentCarouselElement = typeof ContentCarousel.CustomElement;
type T_HTMLContentCarouselSlideElement =
  typeof ContentCarouselSlide.CustomElement;
declare global {
  interface HTMLContentCarouselElement extends T_HTMLContentCarouselElement {}
  interface HTMLContentCarouselSlideElement extends T_HTMLContentCarouselSlideElement {}
  interface Window {
    HTMLContentCarouselElement: HTMLContentCarouselElement;
    HTMLContentCarouselSlideElement: HTMLContentCarouselSlideElement;
  }
  interface HTMLElementTagNameMap {
    "content-carousel": HTMLContentCarouselElement;
    "content-carousel-slide": HTMLContentCarouselSlideElement;
  }
}
export type { HTMLContentCarouselElement, HTMLContentCarouselSlideElement };
