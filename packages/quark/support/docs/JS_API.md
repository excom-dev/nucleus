# JS API

The `Quark` class hosts a sheet programmatically (tests, tooling), settles on demand and reports to the shared DevTools hook.

## `Quark`

```ts
import { Quark } from "@excom/quark";

const quark = new Quark({
  src: `span { content: "four times two equals #{twice(4)}"; }`,
  modules: { dfault: { twice: (n) => n * 2 } },
});
quark.register({ sheetElement }); // host = sheetElement.parentElement
// …
quark.unregister();
```

`isScoped` mirrors `<quark-sheet>`'s default (see [Sheets & scoping](./SHEETS.md)); `modules` pre-provides what `@use` would import; `Quark.moduleLoader` can be overridden in tests.

`Quark.whenSettled({ timeout? })` resolves once no rule pass, paint, async `content` or `@use` load is pending (`"settled"`), or after `timeout` ms (`"timeout"`, default 1000) — for tests and tools; sheets have no after-render hook.

Writing `$variables` from app code goes through `element.quark` — see [Writing from JS](./JS_WRITES.md).

## DevTools

Quark reports to the same global hook as Neutron. The Nucleus DevTools extension installs it at page load; for tests or late attachment call `Quark.attachDevtools()` (identical to `Neutron.attachDevtools()`).

Publications, one per property resolution on a matched element:

- `["quark", "sheet", "registered" | "unregistered"]` on the host — `sheetId`, `ruleCount`, `isScoped`
- `["quark", "apply"]` — `selector`, `key`, `expression`, `result`, `runId`, `isNoop` / `isWipe`
- `["quark", "error"]` — a failed expression (`errorMessage`), which never wipes; also a loop-guard trip (`errorName: "LoopGuardDepth"` / `"LoopGuardBatch"`, `key` = the dropped attribute / binding, see [Loop guard](./LOOP_GUARD.md))
- `["quark", "diagnostic"]` — a `@warn` / `@debug` / `@error` statement that spoke: `level`, `values`, `message`, `expression`, the selector and element (see [Diagnostics](./DIAGNOSTICS.md))
- `["quark", "delay"]` — a `@delay` block `scheduled` (with `ms`), `fired`, or `dropped` (with `reason`: `"disconnected"`, `"unregistered"`, `"unmatched"`; see [`@delay`](./DELAY.md))
- `["quark", "transition"]` — a commit holding `@view-transition` writes: `phase: "start"`, `"settled"` (with `result`: `"settled"` / `"until"` / `"timeout"`) or `"skip"` (with `reason`: `"unsupported"`, `"reduced-motion"`, `"hidden"`, `"unchanged"`, `"active"`, `"error"`), plus `types` and the number of `paints`

The extension can also paint a whole-document paint-count heatmap from the `apply` records (toolbar icon → "Paint heatmap"); nothing is written to the page's elements.

The extension's Element › Orchestration tab lists them, plus the selected element's current `$variables`, Quark-written attributes and CSS custom properties, listeners (with the `@on` handlers that attached them) and `iterate()` row context.

```ts
Quark.attachDevtools({
  version: 1,
  publicize: (path, meta) => console.log(path.join("/"), meta),
});
```

The renderer Quark injects into the hook (`hook.inject(renderer)`, `kind: "quark"`) also carries the on-demand queries behind the extension's agent tools: `inspect(el)` (the snapshot above), `sheets()` (every registered sheet with host, scope, source and rules), `matchingRules(el)` (rules whose selector matches `el` now, scope-aware, in definition order) and `evaluate(el, expression, sheetId?)` (an expression evaluated as a rule on `el` would see it, `@use` modules from `sheetId` or the first matching sheet). All three are read-only queries over already-built state.

## Language metadata

The documented language surface (keywords, declaration kinds, at-rules, built-ins, allowed methods, pseudo-class support) is data on `@excom/quark/language`, off the main entry so its prose stays out of app bundles. The reference tables on these pages are generated from it.
