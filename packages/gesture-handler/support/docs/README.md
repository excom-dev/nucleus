# gesture-handler

Let users drag, swipe, pinch and flick your UI — sheets, carousels, cards and images follow the finger, in CSS, with no per-frame script.

<include-content data-demo="sheet"></include-content>

## Features

- **Swipe / pan / pinch / rotate / tap / long-press** Each recognized gesture is a tag-prefixed event
- **Follow the finger in CSS** Every frame lands in `--gesture-*` custom properties: scrubbable bottom sheets, swipe-to-dismiss, pinch-to-zoom, pull-to-refresh, parallax
- **Snap & fling** `snap-points` with velocity projection, a CSS transition on release (`--gesture-snap-duration` / `--gesture-snap-ease`), `gesture-handler-snap` when it lands
- **Drivable** Bounds, `progress-offset` and `is-disabled` are attributes a Quark rule sets from the driven element's state
- **Scoped starts** `from-ref` for drag handles, `from-edge` for edge swipes
- **Scroll handoff** `handoff-ref` lets a sheet's own scrolling content take the drag over when it runs out of scroll — a native-feeling pull-to-close
- **Native scrolling kept** `touch-action` follows `gesture-types`, so the page still scrolls where you don't pan

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Wrap the surface the user touches. Pick the gestures with `gesture-types`; read the finger from `--gesture-*` in CSS (custom properties inherit, so any descendant can `var()` them); commit State on `gesture-handler-end` or `-snap` from a Quark `@on` block.

```html
<gesture-handler gesture-types="pan-y swipe" progress-axis="up" range-ref=":scope > content-drawer" snap-points="0 1">
  <quark-sheet>
    :scope {
      @on gesture-handler-start { content-drawer { is-scrubbing: ""; } }
      @on gesture-handler-end { content-drawer { is-open: event.detail.snap == 1; is-scrubbing: none; } }
    }
  </quark-sheet>
  <content-drawer>…</content-drawer>
</gesture-handler>
```

`--gesture-progress` is the travel along `progress-axis` as a fraction of the range (`range-ref` measures the driven element; `range-px` is a literal), clamped to `progress-min`..`progress-max` with optional `overshoot-resistance`. Written alongside it every frame: `--gesture-dx` / `-dy`, `--gesture-x` / `-y`, `--gesture-scale`, `--gesture-rotate`, `--gesture-vx` / `-vy`, `--gesture-pointers`; once per gesture: `--gesture-range-px`, `--gesture-width` / `-height`. Everything else is derived from those in the element's own CSS — `--gesture-distance`, `--gesture-angle`, `--gesture-progress-px`, `--gesture-x-ratio` / `-y-ratio` — so `var()` them the same way.

Values persist after release until the next gesture starts. On release the default action writes `--gesture-progress` straight to `detail.snap` and the element's own `transition` settles it there over `--gesture-snap-duration` (`200ms`) with `--gesture-snap-ease` (`ease-out`), firing `gesture-handler-snap` when it lands; the transition is off while `is-active`, so the finger itself is never eased, and a new gesture that interrupts the settle simply cancels it (no `-snap`).

### Driving Nucleus Kit elements

Elements that can be scrubbed expose a `--<tag>-…-progress` input and an `is-scrubbing` attribute; both default to the wrapping gesture-handler's `--gesture-progress`, so no mapping is needed:

| Element | Set up | While `is-scrubbing` |
| --- | --- | --- |
| `content-drawer` | `progress-axis` towards its open side, `range-ref` the drawer, `handoff-ref` the drawer too (it scrolls its own content) | Position follows `--content-drawer-open-progress` (`0` closed, `1` open), no transition |
| `content-carousel` | `slide-animation="track"`, `progress-min="-1" progress-max="1" snap-points="-1 0 1"` | The track follows `--content-carousel-progress` in slide widths |

The handoff is one Quark commit: the block that writes the final state (`is-open`, the active slide) also removes `is-scrubbing`, so the element switches from finger to State in the same paint. Commit on `-end` when a CSS transition should finish the motion (the drawer), on `-snap` when the element must be exactly at the snap point first (the carousel).

Anything else follows the same recipe: read `--gesture-*` in your own CSS, gate the mapping on a fact your sheet writes on start and clears on end.

Give a drag handle `touch-action: none` when using `from-ref`, so the browser does not scroll it away; without `from-ref` the element sets `touch-action` itself from `gesture-types`. Add `mouse` to `pointer-types` for desktop dragging.

### Scroll handoff

`handoff-ref` names the scroll container(s) inside the surface whose *overscroll* starts a gesture (a `:scope`-relative selector; a comma list matches several). A pointer that goes down in one of them scrolls natively as usual. Only when its **first** move runs along `progress-axis`, the container is at its scroll limit that way, and `progress-offset` still has room to travel in that direction does the element cancel the native scroll for the rest of the touch and take the drag over — the same gesture, the same `--gesture-*` values and the same `-start` / `-end` / `-snap` events as a drag from a handle:

```html
<gesture-handler gesture-types="pan-y swipe" progress-axis="up" snap-points="0 1"
  from-ref=":scope > content-drawer > header" handoff-ref=":scope > content-drawer"
  range-ref=":scope > content-drawer">
```

An open sheet (`progress-offset: 1`) closes either from its header or by pulling its text down once the text is back at the top; pulling up, or pulling down mid-scroll, keeps scrolling. `handoff-ref` is additive — `from-ref` and `from-edge` starts are unchanged, and a `from-ref` handle inside a handoff container still starts on pointerdown. The element keeps `touch-action` out of the way while `handoff-ref` is set (the containers must be able to scroll), so give handles their own `touch-action: none`.

Mouse drags (`pointer-types="… mouse"`) take the same route with no native scroll to cancel: the first `pointermove` inside the container starts the gesture when the container is at its limit.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Swipeable carousel

`slide-animation="track"` turns `content-carousel` into a draggable track. `progress-axis="left"` makes a leftward drag pull the next slide in; the `:has()` rules narrow the bounds at the first and last slide so nothing wraps mid-drag; the `gesture-handler-snap` block swaps `is-active` and un-scrubs in one commit.

<include-content data-demo="carousel"></include-content>

#### Pinch, rotate, drag

Two fingers (a trackpad or touch screen) for `--gesture-scale` and `--gesture-rotate`; one for `--gesture-dx` / `--gesture-dy`. Pure CSS mapping, no sheet. Each gesture starts from the resting values.

<include-content data-demo="pinch"></include-content>

#### Swipe to dismiss

`snap-points="-1 0 1"` with a literal `range-px`: a flick past `swipe-min-velocity` snaps the card off to the side, and the `gesture-handler-snap` block records the fact. A tap starts a new gesture (values reset) and clears it.

<include-content data-demo="swipe"></include-content>
