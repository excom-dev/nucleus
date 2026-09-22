# renderable-element

Composition base for Neutron elements that defer rendering a `<template>`
until the right moment. It owns the load + render lifecycle so subclasses
only decide *when* to flip `is-active`. Used by `<include-content>`,
`<spa-route>`, and any custom element you compose yourself.

The demos below use `<include-content>` (the simplest concrete subclass)
to exercise behavior that comes straight from this mixin.

<include-content data-demo="persist-content"></include-content>

## Features

- **Template resolution** via `template-ref` in-document selectors or remote URLs
- **Prefetch strategies** `lazy` (default), `eager`, or `idle`
- **Configurable render host** light DOM, shadow, author iframe, or any selector
- **Cancelable render / unrender** parents can wrap updates in view transitions
- **Persistable content** keep live subtree state across unrender / render cycles
- **Ready coordination** `ready-on` + `delaying-ready` for paint-synced reveals

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Compose `RenderableElement` into a Neutron class and toggle `isActive`
from whatever signal makes sense — a media query, a websocket message,
an experiment flag, etc. Everything else (template fetch, caching, host
resolution, lifecycle events) is inherited.

```ts
import { Neutron } from "@excom/neutron";
import { RenderableElement } from "@excom/renderable-element";

export const MediaGated = Neutron.compose([
  RenderableElement,
  Neutron({
    tag: "media-gated",
    props: {
      mediaQuery: String,
    },
  }),
])
  .onPropChanged("mediaQuery", (el, prev) => {
    prev.mediaQuery && el._mql?.removeEventListener("change", el._sync);
    if (!el.mediaQuery) return { isActive: false };
    el._mql = window.matchMedia(el.mediaQuery);
    el._sync = () => (el.isActive = el._mql.matches);
    el._mql.addEventListener("change", el._sync);
    el._sync();
  });

MediaGated.define();
```

```html
<media-gated media-query="(min-width: 900px)">
  <template>
    <wide-screen-only></wide-screen-only>
  </template>
</media-gated>
```

Event names are prefixed with the concrete tag (shown as `{tag}-…` in the
API). For `<include-content>` that means `include-content-render`, etc.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Choosing a render host

Unset `host-ref` renders into the element's light DOM. `"shadow"` attaches
an open shadow root for style isolation:

<include-content data-demo="host-shadow"></include-content>

`"iframe"` paints into a child `<iframe data-render-host>` you provide —
sandbox styles / scripts / document context. Only nodes move: custom
elements upgrade there only if the iframe document loads their definitions:

<include-content data-demo="host-iframe"></include-content>

Any other value is a CSS selector — the template lands in whatever
element it resolves to:

<include-content data-demo="host-selector"></include-content>

#### Hooking render with view transitions

`render` and `unrender` are cancelable; `event.detail` is the update
thunk. A parent can `preventDefault()` and run the mutation inside
`document.startViewTransition()` — the same pattern `<spa-manager>`
uses to batch sibling routes.

<include-content data-demo="render-event"></include-content>

The thunk's returned Promise resolves when the view is ready (immediately, or when `ready-on` fires). If `is-active` is unset while still loading / `delaying-ready`, teardown rejects that Promise and emits `aborted` instead of `unrender`.

Pair with `ready-on` so `delaying-ready` stays set until your transition
has committed:

```html
<media-gated ready-on="my-app-paint" media-query="(min-width: 900px)">
  <template>...</template>
</media-gated>
```

```css
media-gated[delaying-ready] {
  display: none;
}
```

#### Persisting content across cycles

Once a template resolves, `did-load` stays set so consumers know later
toggles are warm — URL `template-ref`s reuse the shared fetch cache in
kit-utils. Without `persist-content` (the default), each activation
re-resolves and imports a fresh clone — subtree state is lost on
unrender. With it, the same live nodes are held across toggles:

<include-content data-demo="persist-content"></include-content>

#### Loading strategies

`pre-fetch` controls *when* the template is fetched, separately from
when it is rendered:

```html
<!-- default: fetch on first activation -->
<my-el></my-el>

<!-- pre-warm immediately on attribute set -->
<my-el pre-fetch="eager"></my-el>

<!-- backfill on idle -->
<my-el pre-fetch="idle" template-ref="/fragments/hero.html"></my-el>
```

Pair with `bypass-cache` for revalidation when the element activates
multiple times. Invoke the `--reload` command to force a refresh.
