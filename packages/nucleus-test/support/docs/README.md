# nucleus-test

Test Nucleus Stack apps and custom elements in Vitest with one setup line: a browser-like DOM, HTML-aware matchers and helpers for clicks, events and `fetch`.

## Features

- **One-line setup** Vitest on happy-dom, patched for browser parity by `@excom/nucleus-dom`
- **Semantic DOM diffs** Compare markup, not whitespace / attribute order; snapshots as readable HTML
- **Listener leak checks** Count event listeners per element and assert them in one line
- **Fixtures / mocks** Mount HTML, click, await events, mock `fetch` responses
- **Complexity snapshots** Snapshot the engine and DOM work a test costs; a changed count flags a regression
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

### Complexity snapshots

Count the work a test causes, in units (rule passes, binding reads / writes, DOM queries and writes), never time, and snapshot it. A changed count is a regression signal: review it, then update deliberately with `-u`. Counts are exact only when the test drives the page itself; a suite that polls a live app on timers and simulated latency gets different counts each run, so measure a single element or a controlled scenario there.

`trackComplexity(engine, { settle? })` snapshots every test in the file (or `describe`) as `<test> > complexity 1`. `engine` is the engine's own counters, `Quark.meter` for Quark; `settle` lets the page finish before the count is taken. Call it after hooks that clear the DOM, since after hooks run last-registered first.

```ts
import { afterEach, trackComplexity } from "@excom/nucleus-test";
import { Quark } from "@excom/quark";

afterEach(() => {
  document.body.innerHTML = "";
});
trackComplexity(Quark.meter, { settle: () => Quark.whenSettled() });
```

For one measurement inside a test, `measureComplexity(engine)` counts from that point: `take()` once the work has settled, `stop()` to restore the DOM, `expectComplexity(budget)` to match the test's `complexity` snapshot. Use it or `trackComplexity` in a file, not both: they share and reset the same counters.

```ts
const meter = measureComplexity(Quark.meter);
details.setAttribute("open", "");
await Quark.whenSettled();
const budget = meter.take();
meter.stop();
expectComplexity(budget);
```

A `ComplexityBudget` holds the engine counters (`quarkRuns`, `ruleRuns`, `variableRuns`, `attributeRuns`, `listenerRuns`, `setVar`, `getVar`, `schedulePaint`), the DOM calls (`querySelectorAll`, `matches`, `closest`, `parentElement`, `setAttribute`, `removeAttribute`, `textContent`, `importNode`) and `queryScopeCost`, the elements scanned by the engine's rule queries, sampled at `take()`. Any engine with `{ counts, reset() }` (`EngineMeter`) can be measured; without `scopeSelectors()`, `queryScopeCost` is 0. `Quark.meter` reads the selectors of the sheets registered at `take()`, so a sheet unregistered inside the measured window no longer counts there.
