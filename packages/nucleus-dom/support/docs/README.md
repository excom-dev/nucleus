# nucleus-dom

Test and server-render Nucleus Stack apps in Node on a DOM that behaves like the browser's.

## Features

- **Tests / SSR** A fresh browser-like `window` per test / request, closed with one call
- **Browser parity** Tree-wide `querySelector` with `:scope`, Invoker Commands (`command` / `commandfor`), `checkVisibility()`, observers that survive garbage collection
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
const markup = document.documentElement.outerHTML; // SSR: respond with this

await dispose();
```

In a test runner's happy-dom environment, install the shims once from a setup file. The environment loads your project's own `happy-dom`: keep it on the version this package pins.

```ts
// test/setup.ts — vitest.config.ts: test: { environment: "happy-dom", setupFiles: ["./test/setup.ts"] }
import { installShims } from "@excom/nucleus-dom";

installShims(globalThis);
```

### Shims

`installShims(window)` applies all four, each also exported on its own. Repeat calls do nothing. Without them, happy-dom:

- `scopeQueriesToDocument` matches `element.querySelector(All)` inside the element only, so `list.querySelector("main li")` misses when `main` is an ancestor; shimmed, `querySelectorAll` on a connected element returns an Array
- `pinMutationObservers` silences a `MutationObserver` at the first garbage collection after `observe()`
- `installCommandShim` ignores `<button command commandfor>` clicks and has no `button.command` / `button.commandForElement`
- `installMissingApis` has no `element.checkVisibility()` (here always `true`: no layout) and no `ServiceWorkerContainer`
