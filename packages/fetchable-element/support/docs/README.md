# fetchable-element

Composition base that owns the `fetch()` lifecycle for Neutron elements —
build the request from attributes, a `<form>`, or a custom override, then
track loading / success / error state automatically.

## Features

- **Shared lifecycle** States, `provision` and events come from [loadable-element](/nucleus/packages/loadable-element)

- **Attribute-driven requests** URL, method, headers, redirect, and
  credentials all configurable declaratively
- **Form-aware** Point `form-ref` at a `<form>` to source action, method,
  enctype, and field values
- **Merged payloads** Attributes, form, and custom args deep-merge
  (lowest → highest priority)
- **Lifecycle state** `is-loading` / `is-success` / `is-error` managed
  for you
- **Provision** `provision` is the parsed response (or error payload) for
  Quark `prop("provision")` — not a reflected attribute
- **Cancel-safe** Superseded or disconnected requests are aborted via
  `AbortableElement`

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Compose `FetchableElement`, then call `doFetch(url, requestInit)` —
usually built via `getFetchArgs(customFetchArgs?)` — whenever the
subclass decides a request should run. Concrete consumers include
`<provider-fetch>` (fetch on attribute change), `<super-form>` (fetch on
submit), and `<web-authn>` (WebAuthn ceremonies that still round-trip to
a server).

```ts
import { Neutron } from "@excom/neutron";
import { FetchableElement } from "@excom/fetchable-element";

export const RefreshOnClick = Neutron.compose([
  FetchableElement,
  Neutron({ tag: "refresh-on-click" }),
])
  .onEvent("click", ({ getFetchArgs }) => ({
    doFetch: getFetchArgs(),
  }));

RefreshOnClick.define();
```

```html
<refresh-on-click api-url="/api/status"></refresh-on-click>
```

Every prop, state field, and event documented below is inherited
verbatim by any element that composes `FetchableElement` — it flattens
directly into that element's own generated docs, so `<provider-fetch>`
and friends don't redeclare it.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

There are no demos for this package — see
[provider-fetch](/nucleus/packages/provider-fetch) for `FetchableElement` in
action against a real endpoint.
