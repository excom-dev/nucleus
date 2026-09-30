# nucleus-test

Test Nucleus Stack apps and custom elements in Vitest with one setup line: a browser-like DOM, HTML-aware matchers and helpers for clicks, events and `fetch`.

## Features

- **One-line setup** Vitest on happy-dom, patched for browser parity by `@excom/nucleus-dom`
- **Semantic DOM diffs** Compare markup, not whitespace / attribute order; snapshots as readable HTML
- **Listener leak checks** Count event listeners per element and assert them in one line
- **Fixtures / mocks** Mount HTML, click, await events, mock `fetch` responses
- **Quiet logs** `console.log(element)` prints `<div#id>`, not thousands of lines

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Install `vitest` 4 and `happy-dom` (the version `@excom/nucleus-dom` pins) next to this package, and add the setup file to your Vitest config.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "happy-dom", setupFiles: ["@excom/nucleus-test/setup"] },
});
```

A test file imports everything from one place, Vitest's own API and `@open-wc/semantic-dom-diff` included.

```ts
import { afterEach, click, expect, fixture, it, waitForEvent } from "@excom/nucleus-test";
import "./x-drawer";

afterEach(() => {
  document.body.innerHTML = "";
});

it("opens on click", async () => {
  const drawer = fixture(`<x-drawer><button>Cart</button></x-drawer>`);
  await waitForEvent(drawer, "x-drawer-open", () => click(drawer.querySelector("button")!));
  expect(drawer).equalTag(`<x-drawer open></x-drawer>`);
});
```

### Matchers

```ts
expect(list).dom.to.equal(`<ul><li>Tea</li></ul>`); // semantic HTML diff
expect(drawer).equalTag(`<x-drawer open></x-drawer>`); // own tag + attributes, children ignored
expect(drawer).toMatchListeners({ click: 1, keydown: 1 }); // exact listener counts per type
expect(window).toContainListeners({ resize: 0 }); // listed types only: none left after removal
expect(list).toMatchInlineSnapshot(); // elements snapshot as indented HTML
```

`getEventListeners(target)` returns the recorded listeners by type; `clearEventListeners(target)` forgets them. Both are globals too.

Types for the matchers and globals come with any import from `@excom/nucleus-test`; the setup file declares none.

### Helpers

- `fixture(html)` mounts `html` in `document.body` and returns its first element
- `click(target, init?)` dispatches a bubbling, cancelable, composed `click`; `false` when prevented
- `waitForEvent(target, type, trigger?, delay?)` resolves `delay` ms after `type` fires, rejects after 1 s; `trigger` runs once it listens
- `wait(ms?)` resolves after `ms`
- `readFileRelative(import.meta.url, relPath)` reads `relPath`, relative to the test file, as text
- `readDemo(import.meta.url, name)` reads `support/demos/<name>.html` from a test in `support/tests`
- `spyFetch(response, ms?)` stubs `fetch` with a response (or a function returning one) after `ms`; status 200 and a JSON `content-type` by default; `vi.restoreAllMocks()` / `restoreMocks: true` restores `fetch`
- `serveStatic(root, { fallback?, api? })` is a `fetch` stand-in serving a directory at the page's origin, like a static dev server, with an SPA fallback and `/api/*` sent to a handler: `vi.spyOn(globalThis, "fetch").mockImplementation(serveStatic(root, { fallback: "index.html" }))`

```ts
const fetchSpy = spyFetch({ body: JSON.stringify({ items: 3 }) });
// … the element under test fetches
expect(fetchSpy).toHaveBeenCalledWith("/api/cart");

spyFetch(() => ({ status: 404 }), 300); // a 404 after 300 ms
```

Console output goes through `consoleSinks`: spy on one to capture / silence it, e.g. `vi.spyOn(consoleSinks, "warn").mockImplementation(() => {})`.
