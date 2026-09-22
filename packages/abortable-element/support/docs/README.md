# abortable-element

AbortController ownership for Neutron elements — cancel in-flight
work cleanly when a newer request supersedes it.

## Features

- **Owned controller** Fresh `AbortController` per in-flight cycle
- **doAbort()** Abort current work and rotate a new controller
- **Fetch-ready** Pass `abortController.signal` into `fetch` /
  template loads

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Compose `AbortableElement` and pass `abortController.signal` into
async work. Call `doAbort()` when that work should be cancelled (e.g.
`template-ref` changed). `RenderableElement` already does this for
template fetches.

```ts
import { Neutron } from "@excom/neutron";
import { AbortableElement } from "@excom/abortable-element";

export const FetchOnce = Neutron.compose([
  AbortableElement,
  Neutron({
    tag: "fetch-once",
    props: { src: String },
  }),
])
  .onPropChanged("src", async (el) => {
    el.doAbort();
    if (!el.src) return;
    const res = await fetch(el.src, {
      signal: el.abortController.signal,
    });
    // …
  });

FetchOnce.define();
```

There are no public attributes — the controller is internal. See
[renderable-element](/nucleus/packages/renderable-element) for the primary
consumer.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>
