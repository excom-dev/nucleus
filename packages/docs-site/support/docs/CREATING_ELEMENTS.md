# Creating Elements

Most apps won't need to define any of their own custom elements. This will continue to get even less necessary as time goes on, as more elements will increasingly be added to the Nucleus Kit catalog.
Reach for your own only when neither the catalog nor Quark can cover the job — and when you do, build it as an **Adapter**: one protocol, its own state, events out.

## Element or rule?

| Write an element when… | Write a Quark rule when… |
| --- | --- |
| The behavior is generic | The behavior is custom |
| It speaks a protocol Quark cannot: an effect, time, focus, a key grammar, the accessibility tree | It reacts to State that is already visible |
| It needs configuration through several attributes | It's a one-off for this view |
| It integrates a browser API (fetch, geolocation, observers, passkeys) | It orchestrates a state transition between existing elements |
| It *catalyzes* change: it originates events or state | It *responds* to a catalyst |
| It wraps and upgrades a native element | It binds data or renders a list |

A useful test: if you find yourself assigning a `$variable` in Quark solely to call a side-effecting function, the behavior wants to be an element with a real event.

## The Adapter contract

> An Adapter is a located element — or a family of elements — that bridges the State and a foreign protocol: a system (network, storage, sensors, the clock, history, the viewport) or a person (pointer, keyboard, focus, the accessibility tree). It carries the protocol's state as attributes and provisions on itself, its occurrences as events, and its non-State machinery privately.

In practice:

- **Bridge one protocol, generically.** The protocol names the job: `content-drawer`, `provider-fetch`. Never the application: `add-to-cart`. Two elements for one protocol is duplication.
- **Manage only your own family.** Write your own attributes freely, and those of your recognized sub-adapters. Never write anything outside the family: invoke foreign elements (an event, a command) or read them (a `*-ref`), never mutate them.
- **Be drivable.** Writing your attributes must reproduce what your protocol would have done. A rule setting `is-open` and a click must be indistinguishable.
- **Attributes in, events out.** Options arrive as attributes. Results leave as state attributes, tag-prefixed events, and a `provision` for rich data. No public method is required to use you.
- **Stateless outside your node.** Everything lives on the instance, or on a sub-adapter. No module-level singletons, nothing on `window`. In-flight machinery — controllers, watchers, timers — stays private.
- **Clean up.** Cancel in-flight work on disconnect. Compose the `abortable-element` base and the cleanup is structural.
- **Never render your own children.** Recognize the children the author writes. Logic-free rendering of author-controlled content (a `<template>` clone, a fetched fragment, a third-party widget) is the narrow caveat, and it must be documented as the element's stated purpose.
- **Expose every opinion as an attribute.** Any default behavior someone might reasonably want to change gets a configurable attribute.
- **Prefer commands and events to methods.** Methods are private by convention and `_`-prefixed. If a consumer needs to tell you to do something, accept it as a command — a `command` event with a short `--verb` (`--submit`, `--reload`, `--open`), handled with Neutron `onCommand` — so a plain `<button command commandfor>` can invoke it. Commands never bubble and carry no payload: read what you need from your own attributes, or from the invoker's `data-*` through `event.source`. Never invent a bubbling `my-element-trigger` event for an imperative.
- **Speak the person's protocols fully.** If a person is on the far side, handle the keyboard grammar, focus, and ARIA state. An interaction element that does not is incomplete, not a different kind of element.
- **Mutable event detail is fine.** Letting listeners write into `event.detail` before a default action has native precedent (`formdata`, `beforeunload`, `respondWith`).

## Sub-adapters

Some jobs need a small family of tags that cannot stand alone: `content-tabs-header` only means something inside `content-tabs`. A **sub-adapter** is a dependent part of its root Adapter: it adapts input at its own node and announces upward, while the root keeps the family's state coherent and may write it. Two rules keep families honest:

1. Share a name prefix so the relationship is visible in markup.
2. The parent should prefer firing non-bubbling events *at* its children and letting them mutate themselves over mutating them directly.

## Building with Neutron

Neutron is a declarative factory over the Custom Elements API. Props reflect to attributes, lifecycles return **effects** instead of mutating, and events come with default actions built in.

```ts
import { Neutron } from "@excom/neutron";

export const CopyButton = Neutron({
  tag: "copy-button",
  props: {
    targetRef: String,          // ↔ `target-ref`
    didCopy: Boolean,           // ↔ `did-copy` (state)
  },
  events: {
    copy: { prefixWithTag: true },   // fires as `copy-button-copy`
  },
})
  .onEvent("click", () => ({
    emit: ["copy-button-copy"],
  }))
  .onEventDefault("copy-button-copy", (el) => {
    const text = document.querySelector(el.targetRef)?.textContent ?? "";
    navigator.clipboard.writeText(text);
    return { didCopy: true };
  });

CopyButton.define();
```

```html
<copy-button target-ref="#snippet">Copy</copy-button>
```

Consumers now have a state attribute to style (`copy-button[did-copy]`), an event to orchestrate against (`copy-button-copy`), and a default action they can cancel with `preventDefault()`. Resetting `did-copy` after a moment is the consumer's job — a Quark rule or a CSS animation — not the element's.

**Props.** Shorthand constructors (`String`, `Number`, `Boolean`, `TokenList`) reflect to kebab-case attributes. `TokenList` (exported by `@excom/neutron`) is a space-separated token attribute read as a `string[]`. `Object`, `Array`, elements, and promises stay on the instance. Rich config adds `defaultValue`, `isValid`, and custom `serialize` / `deserialize`. All custom attributes should contain dashes, to future-proof the element against later-defined native attributes.

**Events.** Events listened-to and fired by the element. By default, they bubble and are composed. Strongly recommended to prefix them with the tag name (`submit` - bad, `super-form-submit` - good) to prevent name conflicts with native events.

**Methods.** Neutron lets you define instance methods, called via effect-syntax like so: `myMethod: [myFirstArg, mySecondArg]`. However - if your method is potentially useful/necessary for the consuming application to call or prevent, it is better to define an event default action instead of a method. Example: `.onEventDefault('my-tag-foo-action', (el, { detail }) => ...)` and call like so: `emit: ['my-tag-foo-action', { detail: { myFirstArg, mySecondArg } }]`.

**Effects.** Every lifecycle and method returns a plain "effect" object/array of instructions: prop values, `emit`, `broadcast`, `style`, `addListener`, and nested effects for element-typed props. Return `{ didLoad: true }`; don't write `el.didLoad = true`. A handler must not set the prop it reacts to.

**Reactions.** `onPropSet` / `onPropUnset` / `onPropChanged` for one prop; `onEffect([...])` for a batch; `onPromiseResolved` / `Rejected` for promise props. `onConstructed` / `onConnected` / `onAdopted` / `onDisconnected` / `onError` for lifecycles. `onEvent` / `onEventDefault` / `onBroadcast` for events.

**Compose.** `Neutron.compose([Base, Neutron({...})])` stacks builders. The Nucleus Kit bases encode shared contracts you can opt into: `abortable-element` (cancelable async work), `fetchable-element` (a request lifecycle with `is-loading` / `is-success` / `is-error`), `renderable-element` (template rendering), `listenable-element` (declarative `listen-for`), `routable-element` (URL matching). Most elements are standalone; compose only when you need the contract.

**Provisions.** To publish rich data, set the `provision` prop (tag it `@provision` in JSDoc). Quark reads it with `prop("provision")` and re-runs when it is assigned; Neutron also fires `neutron-provision` for app JS. Provisions must be plain objects or arrays — assign a new one, in-place mutation is not observed.

See the [neutron](/nucleus/packages/neutron) package for the complete API.

## Naming Recommendations

| Thing | Rule | Example |
| --- | --- | --- |
| Tag | Prefix by shape: `super-` wraps a native, `content-` expects children, `provider-` publishes data | `super-form`, `content-drawer`, `provider-fetch` |
| Attribute | Always contains a dash; booleans read as assertions | `target-ref`, `is-loading`, `did-fail`, `should-fetch` |
| `*-ref` attribute | Holds a CSS selector or a URL | `template-ref`, `form-ref` |
| Event | Prefixed with the tag name | `super-form-success` |
| Private state / method | Leading underscore | `_queue`, `_flush()` |
| Element base | `*Base` | `FetchableBase` |

Property and method names must not collide with anything on `HTMLElement`, now or plausibly in the future.

## Don't

- **Don't use shadow DOM** unless isolation is absolutely necessary. It blocks the state-driven CSS and Quark rules the whole stack depends on and severely hampers composability even with slots.
- **Don't hold hard references to other elements.** Use `WeakRef` / `WeakSet`, and clear any parent reference in `onDisconnected`.
- **Don't render or mutate children** beyond the caveat above. If a parent must coordinate, fire events at children.
- **Don't add cross-cutting features.** `super-form` should not grow a `success-scroll-to` attribute; it should fire `super-form-success` and let `scroll-into-view` do the scrolling.
- **Don't observe more than you need.** Every state attribute is something Quark may watch. Keep the surface minimally comprehensive.

## Documenting

Elements are documented from JSDoc: `@option` and `@state` on props, `@provision` on the provision prop, `@fires` / `@listens` with `@type` naming the event type. Events deserve the most care: say exactly when they fire, the shape of `detail`, and whether `preventDefault()` skips a default action. Package READMEs open with a one-sentence pitch and the simplest possible demo, then a Features list in the consumer's own words. The [docs site](/nucleus) generates the rest.
