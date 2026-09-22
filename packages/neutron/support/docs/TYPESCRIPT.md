# TypeScript

Expose an element's inferred type the way the DOM exposes its own elements, so queries and `createElement` need no casts.

## Global element types

`Neutron()` infers the element type from `props` and `defineMethods`. Publish it as a global `HTML*Element` interface plus an `HTMLElementTagNameMap` entry, so `document.querySelector("press-tracker")` and `document.createElement("press-tracker")` are typed without casts:

```ts
// index.ts — the package entry defines and types the element
import { PressTracker } from "./press-tracker";

PressTracker.define();

export { PressTracker };

type T_HTMLPressTrackerElement = typeof PressTracker.CustomElement;
declare global {
  interface HTMLPressTrackerElement extends T_HTMLPressTrackerElement {}
  interface Window {
    HTMLPressTrackerElement: HTMLPressTrackerElement;
  }
  interface HTMLElementTagNameMap {
    "press-tracker": HTMLPressTrackerElement;
  }
}
export type { HTMLPressTrackerElement };
```

`CustomElement` is a type-only handle on the builder (there is no runtime value); `Props` is the inferred props object.

## Typed rich props

To type a rich prop more precisely than its constructor allows, cast the constructor with `ConstructorType<T>`:

```ts
import { ConstructorType, Neutron } from "@excom/neutron";

type FeatureInfo = { fullSupport: string[]; noSupport: string[] };

Neutron({
  tag: "detect-features",
  props: {
    provision: Object as unknown as ConstructorType<FeatureInfo>, // el.provision: FeatureInfo
  },
});
```

## Event types

Document Neutron-emitted events with `TEvent` plus `type` and `detail` — see [Events](./EVENTS.md#md-typing-events).
