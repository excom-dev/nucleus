# Lifecycles

Chain `.on*` handlers that return effects; Neutron applies them, tracks listeners, and routes errors.

## Handlers

Each handler receives the element first, then any lifecycle-specific argument, and returns an [effect](./EFFECTS.md). Prefer effects over mutating the element directly. Every `on*` has an `off*` twin that unregisters the same function.

```ts
Neutron({ tag: "panel-host", props: { isReady: Boolean } })
  .onConstructed(() => ({ /* runs in the constructor, before connect */ }))
  .onConnected(() => ({
    // every connect, including reconnects
    isReady: true,
    emit: ["panel-host-ready"],
  }))
  .onDisconnected((el) => ({
    // tear down; `el.isMoving` is true when a disconnect is followed by a connect in the same tick
    isReady: false,
  }))
  .onAdopted(() => ({}))
  .onError((_el, err) => {
    console.error(err);
  });
```

Disconnect is settled one microtask after `disconnectedCallback`. If the element is re-inserted before then (a DOM move), `onDisconnected` and `onConnected` both still run, with `isMoving` set. An error thrown by any handler is routed to `onError(el, error)`; without an `onError`, it is rethrown.

Reactions to prop changes, events, commands and promises are their own pages: [Prop reactions](./PROP_REACTIONS.md), [Events](./EVENTS.md), [Commands](./COMMANDS.md), [Promise props](./PROMISE_PROPS.md).

## Destructure the element argument

Prefer `({ prop }) => …` over `(el) => …`. A handler that only ever sees the values it names cannot reach for `el.setAttribute`, `el.querySelector(…).value = …` or any other imperative mutation — reading the signature is enough to know the handler is pure, and the effect it returns is the whole story.

```ts
Neutron({ tag: "price-tag", props: { amount: Number, currency: String } })
  .onPropChanged(["amount", "currency"], ({ amount, currency }) => ({
    ariaLabel: `${amount} ${currency}`,
  }));
```

## Pitfall: stale values in async callbacks

Destructuring copies the values at call time. If the handler starts asynchronous work and the callback reads those copies, it sees the element as it was when the work started, not when it finished:

```ts
// ✗ `amount` here is whatever it was when the fetch began
.onConnected(({ apiUrl, amount }) => ({
  addListener: ["price-tag-refresh", () => fetch(apiUrl).then(() => console.log(amount))],
}))
```

Make the callback a `defineMethods` method instead. [Methods](./METHODS.md) are effectors too — Neutron calls them with the live element first — so the callback destructures fresh values when it actually runs, and its return value is applied as an effect. The lifecycle keeps `el` only to reach the method (methods are bound to the element; call them as `el.method(…)`):

```ts
Neutron({ tag: "price-tag", props: { apiUrl: String, amount: Number } })
  .defineMethods({
    // runs later, with the element as it is *then*
    applyQuote: ({ amount }, quote: { rate: number }) => ({
      amount: amount * quote.rate,
    }),
  })
  .onConnected((el) => ({
    addListener: [
      "price-tag-refresh",
      () => fetch(el.apiUrl).then((r) => r.json()).then((quote) => el.applyQuote(quote)),
    ],
  }));
```
