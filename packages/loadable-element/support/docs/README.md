# loadable-element

Loading / success / error state, a `provision`, and the three events — once, for every element that does async work.

## Features

- **Three states** `is-loading` / `is-success` / `is-error`, mutually exclusive
- **One payload** The result or the error lands on `provision`
- **Three events** `{tag}-loading` / `{tag}-success` / `{tag}-error`, tag-prefixed automatically
- **Four effects** `_setLoading`, `_setSuccess`, `_setError`, `_resetLoadState` — the element decides *when*, the base does the bookkeeping

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Compose `LoadableElement` and call its effects from your own lifecycles. `FetchableElement` (and every element built on it) and `quark-sheet` compose it this way.

```ts
import { LoadableElement } from "@excom/loadable-element";
import { Neutron } from "@excom/neutron";

export const LoadJson = Neutron.compose([
  LoadableElement,
  Neutron({ tag: "load-json", props: { srcUrl: String, _promise: Promise } }),
])
  .onPropSet("srcUrl", ({ srcUrl }) => [
    { _setLoading: [] },
    { _promise: fetch(srcUrl).then((r) => r.json()) },
  ])
  .onPromiseResolved("_promise", (_, { _promise }) => ({ _setSuccess: [_promise] }))
  .onPromiseRejected("_promise", (_, { _promise }) => ({ _setError: [_promise] }));

LoadJson.define();
```

```html
<load-json src-url="/api/user"></load-json>
```

```quark
load-json[is-success] { $user: prop("provision"); }
load-json[is-error] [bind-message] { content: prop("provision").message; }
```

Cancelled or superseded work calls `_resetLoadState` (no event) — pair with [abortable-element](/nucleus/packages/abortable-element) to abort the promise itself.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>
