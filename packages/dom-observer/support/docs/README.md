# dom-observer

Fire an event whenever a configured element mutates.

<include-content data-demo="simple"></include-content>

## Features

- **Mutation events** Fires `dom-observer-change` on target changes
- **Selector-based** `target-ref` resolves any element, anywhere
- **Waits for its target** No matching element yet? It watches for one
- **Fires once immediately** An empty-`mutations` fire on resolve lets
  listeners seed from current state
- **`<template>`-aware** Also observes a template's `.content` fragment

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Point `target-ref` at any selector, then react to `dom-observer-change`
with `<event-handler>` (or Quark).

```html
<dom-observer target-ref="#watched"></dom-observer>
<event-handler listen-for="dom-observer-change" target-ref="#log">
  <!-- runs on every #watched mutation, and once on attach -->
</event-handler>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Waiting for the target to exist

If nothing matches `target-ref` at connect time, `<dom-observer>` watches
the document for a match and switches over automatically — no glue code:

```html
<dom-observer target-ref="article#late"></dom-observer>
```

#### Observing a `<template>`

A `<template>`'s authored content lives on its `.content`
`DocumentFragment`, not as DOM descendants of the `<template>` itself.
`<dom-observer>` observes both, so mutations to either surface through the
same event stream:

```html
<template id="rows">
  <li>seed</li>
</template>
<dom-observer target-ref="#rows"></dom-observer>
```
