# nucleus-dom

Test and server-render Nucleus Stack apps in Node on a DOM that behaves like the browser's.

## Features

- **Tests / SSR** A fresh browser-like `window` per test, or one that loads page after page for a prerender
- **Browser parity** Tree-wide `querySelector` with `:scope` / `:has(~ …)`, Invoker Commands (`command` / `commandfor`), `checkVisibility()`, observers that survive garbage collection
- **Offline site** Serve a directory to `fetch()` and stylesheet loads, mock `/api/*`
- **Settled pages** Wait until no request, timer or animation frame is pending
- **Any test runner** No Vitest / Jest dependency; `installShims(globalThis)` upgrades a runner's happy-dom environment
- **Pinned happy-dom** One exact version, the one every shim is verified against

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

`createDom({ url, html })` opens a happy-dom window with every shim installed; `dispose()` closes it, stopping its timers and aborting its fetches. `url` defaults to `http://localhost/`; `html` is a whole document or body markup.

```ts
import { createDom } from "@excom/nucleus-dom";

const { document, dispose } = createDom({
  url: "https://shop.test/cart",
  html: `<button command="--open" commandfor="cart">Cart</button><dialog id="cart"></dialog>`,
});

document.getElementById("cart").addEventListener("command", (event) => console.log(event.command)); // "--open"
document.querySelector("button").click();

await dispose();
```

The window never loads script files (`<script src>` still fires `load`), never evaluates page scripts and never navigates its main frame. More options:

- `viewport` sizes `innerWidth` / `innerHeight` and `matchMedia()`: `{ width, height }`, 1024 × 768 by default
- `holdTimersAbove` holds timers longer than this many ms: they never fire and never count as pending work
- `intersectAll` makes `IntersectionObserver` report every observed element in view, so lazy-loaded content renders; happy-dom's own never reports
- `settings` takes happy-dom settings, over the defaults above

In a test runner's happy-dom environment, install the shims once from a setup file. The environment loads your project's own `happy-dom`: keep it on the version this package pins, in one copy, since `installShims` throws on another.

```ts
// test/setup.ts — vitest.config.ts: test: { environment: "happy-dom", setupFiles: ["./test/setup.ts"] }
import { installShims } from "@excom/nucleus-dom";

installShims(globalThis);
```

### Serve files / settle

`serve()` answers the window's requests from a directory, at the window's origin and offline. `whenIdle()` resolves once no request is in flight and no timer or animation frame is due.

```ts
import { createDom, serve, whenIdle } from "@excom/nucleus-dom";
import { expect, it } from "vitest";

it("shows the price it fetched", async () => {
  const { window, document, dispose } = createDom({ url: "https://shop.test/" });
  const { requests } = serve(window, "public"); // public/price.json: {"amount":7}

  window.customElements.define(
    "x-price",
    class extends window.HTMLElement {
      async connectedCallback() {
        const { amount } = await (await window.fetch(this.getAttribute("src")!)).json();
        this.textContent = `$${amount}`;
      }
    }
  );
  document.body.innerHTML = `<x-price src="/price.json"></x-price>`;

  await whenIdle(window);
  expect(document.body.textContent).toBe("$7");
  expect(requests).toMatchObject([{ method: "GET", url: "https://shop.test/price.json", status: 200 }]);
  await dispose();
});
```

- `serve(window, root, { fallback?, api?, readOnly? })` also serves `fallback` for an extensionless path with no file of its own (SPA deep links), sends `/api/*` to `api` first (a mock backend; `null` leaves the request to the files) and, with `readOnly`, refuses every method but GET / HEAD with 405 before `api` sees it. Files never take writes, other origins get a network error, and `requests` logs every request with its status and the SHA-256 `digest` of the body it got. A test runner's window works too: `serve(globalThis, root)`
- `whenIdle(window, { quiet?, timeout? })` needs a `createDom()` window and resolves after `quiet` (2) idle checks in a row. It rejects after `timeout` ms (2000) with `error.pending` naming what is still due, and a running `setInterval` never goes idle
- `resetDocument(window, { url, html?, beforeParse? })` loads another page into the same window as a first visit: the `customElements` registry, module state and `window` / `document` listeners stay; storage, cookies and history are cleared; what the old page still has due after 50 ms is cancelled. `beforeParse` runs between the two pages: reset module-level state there. The new page parses whole, then each definition, in definition order, upgrades its elements in place, as a deferred script's `define()` would: the same element objects, their attributes and children there. `<template>` content stays undefined until imported or inserted. A constructor or callback that throws while a page unloads or loads is reported as an uncaught error (an `error` event on the window, and its console), and the load goes on. Unlike in a browser, every definition exists from the start: code that runs meanwhile sees later names defined and constructs the elements it creates at once, and an element moved before its turn still upgrades at its turn. Page scripts stay inert, and `document.readyState` stays `"complete"`
- `installGlobals(window)` puts the window's globals on `globalThis`, so browser modules imported in Node run against it, and returns the restore function. Install before importing modules that bind at import time, restore before `dispose()`. While installed, a bare `setTimeout` / `fetch` in Node-side code is the window's too: take tooling timers from `node:timers`
- `findParseDifference(here, html)` returns the first place where a browser would parse `html` into other elements than `here` holds, or `null`. `here` is the document that `html` serializes (its doctype, then `documentElement.outerHTML`), where trees only scripts build show too (a `<div>` appended to a `<p>`, rows appended straight to a `<table>`), or a window that defines no element, whose parser then reads `html` as well. `findParseDifference(window, "<p><x-card><section>Menu</section></x-card></p>")` is `{ path: "html > body > p > x-card", here: "<section>", browser: "nothing", line: 1, column: 12 }`: a browser ends the `<p>` at `<section>`. `unclosed` names an element with no end tag that a browser reads the rest of the page into, such as `<title>`, `<textarea>` or `<select>`. Tags, nesting, order and attributes are compared, template content included; text, comments, namespaces and what a closed `<noscript>` / `<select>` holds are not. Without a doctype a browser parses `html` in quirks mode
- `sameTree(html, other)` is `true` when a browser parses both documents into the same tree: nodes, text and attribute values exactly, the order of attributes within a tag aside. `parseTree(html)` returns that tree as plain data: `{ tag, attributes, children }`, `{ text }`, `{ comment }`, `{ doctype }`, a `<template>`'s content as its children

[nucleus-ssr](/packages/nucleus-ssr) builds on these to prerender a whole site.

### Shims

`installShims(window)` applies all nine, each also exported on its own. Repeat calls do nothing. Without them, happy-dom:

- `supportSelectors` answers selectors unlike a browser: it matches only the first compound of a complex selector inside `:not()` / `:is()` / `:where()` / `:has()` (`ul:not(ul ul)` never matches), throws on `:has(~ …)`, drops and misorders the matches of `+` / `~` in queries, matches `element.querySelector(All)` inside the element only (`list.querySelector("main li")` misses when `main` is an ancestor), keeps `matches()` / `closest()` answers that a change to a sibling, a descendant or a farther ancestor made stale, and gets many pseudo-classes (`:empty`, `:defined`, `:lang()`, form states), attribute flags and escaped names wrong; shimmed, `matches()`, `closest()` and the `querySelector(All)()` of elements, documents, fragments and shadow roots answer as Chrome does, afresh on every call, and an invalid selector, an unknown pseudo-class included, throws a `SyntaxError` `DOMException`. Dialogs too: `:modal` holds from `showModal()` until `close()`, and `show()` on a modal dialog, or `showModal()` on one that `show()` opened or that is in no document, throws `InvalidStateError`
- `pinMutationObservers` silences a `MutationObserver` at the first garbage collection after `observe()`
- `installCommandShim` ignores `<button command commandfor>` clicks and has no `button.command` / `button.commandForElement`
- `installMissingApis` has no `element.checkVisibility()` (here always `true`: no layout), no `ServiceWorkerContainer` and no `code` on a `DOMException`
- `upgradeClones` upgrades only the elements connected when `define()` runs, and calls the definition's callbacks on the rest; shimmed, an undefined element gets no callbacks, `document.importNode()` upgrades what it imports with the importing document's definitions, and an insertion upgrades what it connects, in tree order, so `<template>` content renders working elements
- `keepFormParents` parents the controls attached together with a `<form>` / `<select>` (a rendered template, a moved subtree) to the wrong object, so `form.contains(input)`, `input.parentNode` and `input.closest("form")` fail; shimmed, the form / select stays their parent
- `supportTableTemplates` moves a `<template>` written inside a table (`table`, `tbody`, `tr`, …) out of it and spills its rows in; shimmed, it stays where it is written, rows and cells inside. It patches happy-dom's parser, so every window in the process gets it, and throws when the window runs another copy of happy-dom
- `ignoreStrayMarkup` lets a stray end tag close elements out of its reach, past a `<template>`, or past a `<div>` for a `</span>` or a custom element's end tag, which ends a view's `<div>` early; it also splits text at a `>` between tags and repeats the text before a `-->` written outside a comment (`a -->` reads `a a -->`). Shimmed, such an end tag closes nothing, and the `>` / `-->` stays in its text node. It patches the parser as `supportTableTemplates` does, with the same throw
- `keepEventPaths` reads the public `parentNode` getter of every ancestor on each dispatch, so a spy on that getter counts events; shimmed, `composedPath()` returns the same path without reading it

Still happy-dom's own:

- `:hover`, `:active`, `:autofill`, `:user-valid`, `:popover-open`, `:fullscreen`, `:playing` and `:state()` never match: it tracks none of these states
- `&`, a comment or a namespace prefix (`svg|rect`) in a selector throws its `SyntaxError`, not a `DOMException`
- `define()` for a tag already in the document replaces each such element with a new instance, without `attributeChangedCallback` for its attributes, and `getElementById()` keeps returning the old one: define elements before the markup that uses them
- A stray end tag still closes past an element a browser may already have closed (`<p>`, `<li>`, a heading, `<button>`, `<select>`, `<form>`, table parts), as does a formatting end tag past a block (`</b>` past a `<div>`) and any end tag inside `<math>`, `<title>` or `<textarea>`; text after an ignored end tag is a Text node of its own
- The parser does not reopen formatting elements (`<p><b>x</p>y`), insert the element a stray `</p>` / `</br>` stands for, drop table parts outside a table, or build `<foreignObject>` content and MathML in a browser's namespaces
