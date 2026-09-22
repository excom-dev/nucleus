# Debug

Application state is the DOM — watch attributes in the inspector; the DevTools hook shows the lifecycles behind them.

## DevTools

Attach the DevTools hook with `Neutron.attachDevtools()` (shared with Quark — one hook receives both lifecycle and orchestration publications; see `@excom/kit-devtools`). Neutron publishes `defined` (once per element definition: the tag and its `{ prop, attr }` pairs — the DevTools extension audits attribute names from it), `constructed`, `connected`, `disconnected`, `effect` (with the handler signature and the effect object), `commit` (changed props), and `error`.

## Loop guard

Runaway reactions are cut by the shared loop guard: a handler that keeps re-queuing itself (or two handlers feeding each other) is stopped after `LoopGuard.limit` (50) runs in one synchronous batch, and an attribute chain that arrives that deep — through Quark rules, other elements' effects, or events — has its next write dropped. Both are logged once (`Loop guard: …`) and published as errors. `LoopGuard` (`@excom/kit-utils`, also `Neutron.DOM.LoopGuard`) exposes `limit`, `configure({ limit, log })` and `onTrip()`. Separately, Neutron rejects a handler that writes the prop it reacts to (see [Prop reactions](./PROP_REACTIONS.md)).
