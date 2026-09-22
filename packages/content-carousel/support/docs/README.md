# content-carousel

Rotate slides on autopilot or on click — galleries, hero banners, walkthroughs.

<include-content data-demo="simple"></include-content>

## Features

- **Auto-play** Rotate on a timer via `auto-play`
- **Manual nav** `--back` / `--next` commands from plain buttons; `rel="prev"` / `rel="next"` positions them
- **Slide or fade** Choose the transition with `slide-animation`
- **Swipeable** `slide-animation="track"` wrapped in [`gesture-handler`](/nucleus/packages/gesture-handler): drag and flick between slides
- **Pauses itself** Manual navigation stops auto-play automatically
- **Bindable position** `.provision` is `{ index, count, lastMove }` — a
  progress readout is one Quark rule on `prop("provision")`

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Wrap `<content-carousel-slide>` elements in a `<content-carousel>`. Mark one
`is-active`, or leave it unset to default to the first.

```html
<content-carousel auto-play="5">
  <content-carousel-slide is-active>One</content-carousel-slide>
  <content-carousel-slide>Two</content-carousel-slide>
  <content-carousel-slide>Three</content-carousel-slide>
</content-carousel>
```

`.provision` is `{ index, count, lastMove }` — set on connect and after
every move, counting only this carousel's own slides. A "2 / 3" readout:

```quark
content-carousel {
  $slide: prop("provision").index + 1;
  $count: prop("provision").count;
  [bind-progress] { content: "#{$slide} / #{$count}"; }
}
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Manual navigation

Invoke `--back` / `--next` from a `<button command commandfor>`. A direct
child with `rel="prev"` / `rel="next"` (or
`.tag-content-carousel-prev` / `.tag-content-carousel-next`) is
positioned as the nav control for you. If you want swipeable slides, you
must use the carousel in conjunction with the [<gesture-handler>](/nucleus/packages/gesture-handler).
A demo exists on that page.

<include-content data-demo="manual"></include-content>

#### Fade transition

`slide-animation="fade"` crossfades instead of sliding.

<include-content data-demo="fade"></include-content>
