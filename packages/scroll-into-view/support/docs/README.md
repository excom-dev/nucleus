# scroll-into-view

Scrolls an element into view — on connect by default, or on click / any event via the inherited `listen-for`.

<include-content data-demo="simple"></include-content>

## Features

- **Scroll on connect** Works with no attributes needed
- **Any trigger** Combine with `listen-for` to scroll on click, custom events, or lifecycles
- **Alignment control** `scroll-align` picks start / center / end / nearest per axis
- **Offset for fixed headers** `scroll-offset` nudges the final position after alignment
- **Skip redundant scrolls** `if-needed` scrolls only when the target isn't already visible

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

By default, `<scroll-into-view>` scrolls *itself* into view as soon as it connects to the DOM. Set `target-ref` to scroll a different element instead, and pair with the inherited `listen-for` to trigger on click or any event rather than on connect.

```html
<!-- Jump to a section on click -->
<scroll-into-view target-ref="#pricing" listen-for="click">
  See pricing
</scroll-into-view>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Offset for a sticky header

`scroll-offset="0 -50"` (negative `<y>`) leaves room for a sticky header after alignment; `scroll-behavior="smooth"` animates the scroll. This is the pattern used to jump between sections without the header covering the target's heading.

<include-content data-demo="sticky-header"></include-content>
