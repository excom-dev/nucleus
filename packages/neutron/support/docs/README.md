# neutron

Define typed custom elements with effect-based lifecycles — props, events, and compose without rewriting the Custom Elements boilerplate.

Neutron is the element factory of the Nucleus Stack: `Neutron({ tag, props })` returns a builder you chain lifecycles onto, then `define()`. Every Nucleus Kit element is a Neutron element, and so is every element you write yourself.

## Features

- **Declarative factory** `Neutron({ tag, props }).… .define()`
- **Typed props** Primitives and `TokenList` reflect to dashed attributes; objects / arrays / elements / promises stay on the instance
- **Effect returns** Lifecycles / methods return a POJO (or an array of them) that sets props, emits, listens, calls methods, and styles
- **Fine-grained reactions** `onPropSet` / `Unset` / `Changed` / `onEffect`
- **Events & broadcasts** Tag-prefixed custom events, cancelable default actions, channel broadcasts
- **Commands** `onCommand("--verb")` handles the HTML Command API — `<button command commandfor>` needs no custom element
- **Listener cleanup** Listeners added through effects are removed on disconnect and restored on reconnect
- **Compose** Combine builders (`Neutron.compose`) for mixin-style packages
- **Recompose** Import a package's raw builder, add / remove lifecycles and methods, then `define()` it yourself
- **DevTools** `Neutron.attachDevtools()` hooks the Nucleus DevTools extension

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Beta disclaimer: Neutron automatically defines your element's Typescript types based upon your element config. This is done via complicated internal typing that has a few known issues. These issues will be resolved in the first stable release.

An element owns its own state (attributes) and announces changes (events). It never renders children or reaches into siblings — coordination belongs to Quark. The rules these examples follow are collected in [Best Practices](/nucleus/docs/best_practices) and [Creating Elements](/nucleus/docs/creating_elements).

```ts
import { Neutron } from "@excom/neutron";

export const PressTracker = Neutron({
  tag: "press-tracker",
  props: {
    pressCount: { type: Number, defaultValue: () => 0 }, // reflects ↔ `press-count`
  },
})
  .onEvent("click", ({ pressCount }) => ({
    // effects are declarative instructions, not imperative mutations
    pressCount: pressCount + 1,
    emit: ["press-tracker-press", { detail: { pressCount: pressCount + 1 } }],
  }));

PressTracker.define();
```

```html
<press-tracker press-count="0">
  <button>Press</button>
</press-tracker>
<!-- `press-tracker[press-count="3"]` is now a CSS / Quark selector -->
```

### Documentation

Defining elements

- [Props](./PROPS.md) — typed props, reflection, `TokenList`, naming rules
- [Provision](./PROVISION.md) — the one property for published rich data
- [TypeScript](./TYPESCRIPT.md) — global element types, `ConstructorType`

Behavior

- [Lifecycles](./LIFECYCLES.md) — `onConnected` & co., destructuring, async pitfalls
- [Effects](./EFFECTS.md) — the object a handler returns
- [Prop reactions](./PROP_REACTIONS.md) — `onPropSet` / `Unset` / `Changed` / `onEffect`
- [Methods](./METHODS.md) — methods as effectors
- [Events](./EVENTS.md) — emits, default actions, broadcasts, listener cleanup
- [Commands](./COMMANDS.md) — `onCommand` for `--verb` commands, the `command` effect
- [Promise props](./PROMISE_PROPS.md) — `onPromiseResolved` / `Rejected`

Composition

- [Compose](./COMPOSE.md) — stack builders into mixin-style packages
- [Recompose](./RECOMPOSE.md) — edit a packaged element before defining it

Runtime

- [Define](./DEFINE.md) — `define()` and class introspection
- [Debug](./DEBUG.md) — DevTools hook, loop guard

### Examples

#### State on connect

```ts
Neutron({ tag: "ready-flag", props: { isReady: Boolean } })
  .onConnected(() => ({ isReady: true, emit: ["ready-flag-ready"] }))
  .define();
```

#### Child element effect across handlers

Assign an element prop, then react to it with a nested effect. Listener callbacks that return effects must be `defineMethods` methods:

```ts
Neutron({
  tag: "focus-host",
  props: {
    inputEl: { type: HTMLInputElement, store: "weak" },
    isFocused: Boolean,
  },
})
  .defineMethods({
    handleFocus: () => ({ isFocused: true, emit: ["focus-host-focus"] }),
    handleBlur: () => ({ isFocused: false }),
  })
  .onConnected((el) => ({
    inputEl: el.querySelector("input"),
  }))
  .onPropSet("inputEl", ({ handleFocus, handleBlur }) => ({
    inputEl: {
      addListeners: [
        ["focus", handleFocus],
        ["blur", handleBlur],
      ],
    },
  }));
```
