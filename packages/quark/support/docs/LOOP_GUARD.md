# Loop guard

Runaway write chains are cut, not prevented: one shared guard bounds every chain Quark, Neutron and `dom-observer` take part in.

## What it cuts

Two rules that flip each other's attributes, a rule and an element effect feeding each other, an event whose listener re-writes the attribute that fired it, or content that re-matches its own paint would otherwise run forever. The Nucleus Stack bounds every such chain with one shared guard, `LoopGuard` from `@excom/kit-utils` (Nucleus Kit users: `Neutron.DOM.LoopGuard`). Each write an engine makes carries the depth of the chain that caused it — Quark attributes, `content`, `$bindings`; Neutron attribute reflection and observed property assignments; `dom-observer` events — and the hop past the limit is **dropped**:

- default limit **50** dependent writes (a legitimate chain is under ten);
- the dropped write is logged once (`Loop guard: a chain of 51 dependent writes reached "data-x" on <p> — …`) and published to DevTools as `quark/error`;
- nothing else happens: no event fires, no attribute is wiped, the sheet is not disabled, and the document keeps the state it had before the drop — the cycle's participants stay wherever the chain left them, so treat a trip as a bug report, not a recovery;
- a new external write in a later task (user input, a timer, a fetch, app JS) starts a fresh chain at zero, so streams of updates never trip, however long.

## API

```ts
import { LoopGuard } from "@excom/kit-utils";

LoopGuard.limit; // 50
LoopGuard.configure({ limit: 100, log: (message) => myLogger.error(message) });
const off = LoopGuard.onTrip(({ kind, target, name, depth, limit }) => {
  // kind: "depth" (a write chain) | "batch" (one Neutron handler re-ran > limit times)
});
```

`configure()` is global and takes effect immediately. `onTrip` fires on every trip (the console line is deduplicated per name per task). Rules that gate on attributes they write for each other are named in a warning when the sheet builds, before anything runs.

## Not covered

Writes Quark and Neutron do not route — plain `setAttribute` / `innerHTML` in app JS — neither count nor get cut, and a declaration is never re-run by the attribute it wrote (`class:` excepted), so a rule cannot loop on its own gate (see [Reactivity](./REACTIVITY.md#md-loops)).
