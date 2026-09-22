# Recompose

A builder is open until `define()` runs: import a package's raw builder, edit it, then register it yourself.

## Import the raw builder

Every element package ships two entries: `index.ts` (calls `.define()` and registers the global types) and the raw element source (`<element>.ts`), which only exports the builder. Import the raw entry, edit it, then register it yourself:

```ts
// app.ts — never import "@excom/detect-browser" (or nucleus-kit) here: that entry defines the element immediately
import { DetectBrowser } from "@excom/detect-browser/detect-browser";

DetectBrowser
  // add lifecycles / methods the package did not ship
  .onPropSet("isStandalone", () => ({ emit: ["detect-browser-standalone"] }))
  .defineMethods({ clearInfo: () => ({ provision: null }) })
  .define();
```

Most recomposition is exactly that: chaining new lifecycles onto a packaged element. Unregistering is rarer and goes through `builtConfig`.

## builtConfig

Every builder exposes its definition as `builtConfig`, a plain object you can read before `define()`:

| Key | Shape |
| --- | --- |
| `tag` | The packaged tag name (also the event prefix). |
| `props` | `{ [propName]: PropConfig }` — the normalized prop configs (`type`, `attr`, `defaultValue`, …). |
| `events` / `broadcasts` | `{ [name]: { prefixWithTag? } }` |
| `methods` | `[name, fn][]` in definition order. |
| `lifecycles` | `{ constructed, connected, adopted, disconnected, error, effect, propSet, propUnset, propChanged, promiseResolved, promiseRejected, broadcast, event, eventDefault }`, each an array of `[names, handler]` pairs in registration order. `names` is the prop / event list the handler was registered with (`[]` for lifecycles without one). |
| `reflectDefaultProps` / `definitionOpts` | As passed to `Neutron()`. |

## Removing a lifecycle

Removal needs the original handler reference, because `off*` matches by function identity. Index into `builtConfig.lifecycles.<lifecycle>[entry][1]` and pass that handler to the matching `off*`:

```ts
// stop detecting on connect; the app calls `el.setBrowserInfo()` when it wants to
DetectBrowser.offConnected(DetectBrowser.builtConfig.lifecycles.connected[0][1]);

// named lifecycles: pass the names too — only those names are detached, the handler keeps any others
DetectBrowser.offPropSet("isStandalone", DetectBrowser.builtConfig.lifecycles.propSet[0][1]);
```

Indexing by position is intentional for now (a friendlier handle may come later); read `builtConfig.lifecycles.<lifecycle>` once to see which entry you are after.

## Adding props

Adding props goes through [`Neutron.compose`](./COMPOSE.md), which also leaves the imported builder untouched (it deep-clones):

```ts
import { Neutron } from "@excom/neutron";

export const StampedDetectBrowser = Neutron.compose([
  DetectBrowser,
  Neutron({ tag: "detect-browser", props: { detectedAt: String } }),
]).onPropSet("provision", () => ({ detectedAt: new Date().toISOString() }));

StampedDetectBrowser.define();
```

## Rules

- Everything must happen before `define()`. The runtime config is built at that moment; later `on*` / `off*` / `defineMethods` calls return the builder but change nothing.
- The raw builder is a module singleton — an in-place edit is visible to every importer. Use `Neutron.compose` when you want a modified copy instead.
- Added handlers run after the packaged ones for the same lifecycle (registration order) and batch into the same effect pass.
- `define("other-tag")` registers the class under a different name. Events configured with `prefixWithTag` keep the packaged prefix, because the prefix comes from the builder's `tag`, not from the registered name.
- Skipping `index.ts` also skips its `declare global` block — add your own (see [TypeScript](./TYPESCRIPT.md)) if you want the tag typed.
