# @use

Import JS modules into a sheet: pure functions, values in and a value out, are the sanctioned way for logic to enter a sheet.

## Importing

`as *` exposes exports bare; `as name` (or the name derived from the url) namespaces them:

```quark
@use "/helpers.js" as *;
@use "/pricing.js" as pricing;

[bind-total] {
  content: formatPrice(pricing.total($items, $tax-rate));
}
```

Imports start as soon as the sheet is parsed and load in parallel; the first rule run waits until they resolve. A failed import is logged and skipped.

`quark:` URLs import Quark's own helpers without a fetch — `@use "quark:math";` derives the namespace `math` — see [Built-in modules](./MODULES.md). Reach for them before writing a module function of your own.

## Writing module functions

A module should be pure business logic: simple functions that take values and return one. It is also the exit for anything Quark cannot yet declare (until the Nucleus stack is out of Beta).

```js
/* pricing.js */
export const total = (items, taxRate) =>
  items.reduce((sum, { price, quantity }) => sum + price * quantity, 0) * (1 + taxRate);
```

A function called from an expression should not read or write the document around it. Bridging a protocol (the network, storage, a sensor, the clock, user devices) belongs to an Adapter: an element that does the work and carries the outcome as attributes and a `provision`, which the sheet reads with `prop("provision")`. Quark leans that way on purpose: it calls module functions synchronously and does not `await` what they return. This is a deliberate design to make logic - that should belong to Adapters - feel awkward in a Quark module.

Two narrow shapes go beyond values:

- **A node it owns.** A function may create an element, render into it and return it for `content:` to place, which is how a third-party renderer reaches the page: `[bind-chart] { content: createChart($series); }` (see [Content](./CONTENT.md)). It should still leave the document around it alone.
- **A listener**, for imperative DOM work Quark has no declaration for, such as moving focus once content renders: `@on include-content-did-render (handle: focusInput);`. It receives the event, `this` being the element (see [`@on`](./ON.md#md-options)).

## Asynchronous work

Quark does not await what a module function returns, so asynchronous work takes one of two paths:

- **Setup that needs no per-element input**, such as importing and configuring a library, is an `await` at the top level of the module. The first rule run waits for `@use` imports, so rules start with the setup done.
- **Work that depends on an argument** returns at once an element the function created, and fills it later. An event on that element announces the outcome, and an `@on` block turns it into State.

```js
/* diagram.js */
const announce = (node, name) =>
  node.dispatchEvent(new Event(name, { bubbles: true }));

const startMermaidRender = async (figure, source) => {
  try {
    const { default: mermaid } = await import("mermaid");
    const { svg } = await mermaid.render(`diagram-${crypto.randomUUID()}`, source);
    figure.innerHTML = svg;
    announce(figure, "diagram-ready");
  } catch (_) {
    announce(figure, "diagram-error");
  }
};

export const renderDiagram = (source) => {
  const figure = document.createElement("figure");
  startMermaidRender(figure, source);
  return figure;
};
```

```quark
@use "/diagram.js" as *;

[data-diagram] {
  content: renderDiagram(attr("data-source"));
  @on diagram-ready { data-is-rendered: ""; }
  @on diagram-error { data-did-fail: ""; }
}
```

Logic heavier than this, such as a widget that needs teardown or incremental updates (a live chart, a map, an editor), is better served by a dedicated custom element.

### Handing rendering to a framework

When a sheet hands a region to a rendering framework that requires sole authority over its DOM (React and similar), that region is the right place for a boundary. The function creates the host element, calls `.attachShadow({ mode: "open" })` on it, gives the shadow root to the framework and returns the host for `content:` to place (`content: renderCalendar($events);`):

```js
export const renderCalendar = (events) => {
  const host = document.createElement("div");
  createRoot(host.attachShadow({ mode: "open" })).render(createElement(Calendar, { events }));
  return host;
};
```

Quark never enters a shadow root, so the framework never meets a write it did not make. See [May or may not play well with others](/nucleus/docs/limitations#md-may-or-may-not-play-well-with-others) in the guides.
