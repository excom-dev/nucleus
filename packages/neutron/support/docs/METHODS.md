# Methods

Methods are effectors like lifecycles: they receive the live element, return an effect, and can hand a value back to the caller.

## Defining methods

```ts
Neutron({ tag: "tally-counter", props: { tallyCount: Number } })
  .defineMethods({
    increment: ({ tallyCount }, step = 1) => ({
      tallyCount: (tallyCount ?? 0) + step,
      returns: (tallyCount ?? 0) + step, // value returned to the caller
    }),
  })
  .define();

// el.increment(2) → number
```

Element first, then the call arguments. Other effects can call them by name: `increment: [2]`. Because Neutron calls a method with the element as it is *then*, methods are also the right shape for async callbacks — see [Lifecycles](./LIFECYCLES.md#md-pitfall-stale-values-in-async-callbacks).

### Pre-declaring signatures

`defineMethods` types `element` as the element *before* that call, so a method cannot reach a sibling defined in the same object. `withTypes<T>()` is a type-only step (no runtime effect) that puts the signatures on the element type first — methods are bound and the element argument is stripped, so declare them as the element sees them. It also makes `typeof Builder.CustomElement` usable for module-level helpers.

```ts
interface Methods {
  flush: FrameRequestCallback;
  schedule: () => void;
}

export const Ticker = Neutron({ tag: "tick-er", props: { tickCount: Number } })
  .withTypes<Methods>();

type El = typeof Ticker.CustomElement;

const label = (el: El) => `${el.tickCount}`;

Ticker.defineMethods({
  flush: ({ tickCount }) => ({ tickCount: tickCount + 1 }),
  schedule: ({ flush }) => {
    requestAnimationFrame(flush); // sibling method, no cast
  },
}).define();
```

## Keep the imperative surface small

If a method is something the consuming app may want to invoke, accept it as a command (`onCommand("--verb")`, see [Commands](./COMMANDS.md)); if it is something the app may want to cancel, fire an event with a default action (`onEventDefault`, see [Events](./EVENTS.md)). Neither needs a public method.
