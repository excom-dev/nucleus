# Adapter, State, Orchestrator

**ASO** is an application architecture where the live document *is* the program's state — not a depiction of it. Autonomous **Adapters**, embedded in a shared, observable **State**, bridge that State and the world outside it. A declarative **Orchestrator** observes the State and writes coordinated updates back into it. Participants never hold references to one another; coordination travels only through the shared surface.

The pattern is abstract. It applies anywhere a structured, addressable, mutable, and observable body of state exists — not only on the web, and not only in user interfaces. The Nucleus Stack is the web realization: Adapters are elements (custom OR native), the State is the DOM, the Orchestrator is Quark.

## Adapter

> An Adapter is a located element — or a family of elements — that bridges the State and a foreign protocol: a system (network, storage, sensors, the clock, history, the viewport) or a person (pointer, keyboard, focus, the accessibility tree). It carries the protocol's state as attributes and provisions on itself, its occurrences as events, and its non-State machinery privately.

Updates cross the bridge in one direction or both. **Driving**: the protocol changes and the Adapter writes State — `provider-fetch` publishes a response, `content-tabs` records the chosen tab. **Driven**: State changes and the Adapter acts on the protocol — `api-url` starts a request, `is-open` moves focus and updates the accessibility tree. The Orchestrator only ever sees the State side of the bridge.

**Requirements** — an Adapter must:

- bridge one protocol. The protocol names the job, and two Adapters for one protocol is duplication
- stay generic: `<content-drawer>` is good, `<add-to-cart>` is bad.
- be drivable: writing its attributes reproduces what its protocol would have done. A rule setting `is-open` and a click must be indistinguishable
- write only itself. "Itself" includes its recognized sub-adapters; nothing outside the family is ever written. Foreign elements are invoked (an event, a command) or read (a `*-ref`), never mutated
- reflect state relevant to consumers (like the Orchestrator) as attributes, and publish rich data as a `provision`
- announce occurrences as tag-prefixed events, so that no consumer needs a reference to it
- hold nothing global, keep in-flight machinery (controllers, watchers, timers) private, and release it when it leaves the State

**Recommendations** — an Adapter should:

- expose each opinionated behavior as a configurable attribute
- prefer event listening over public methods. Methods are private by convention and `_`-prefixed
- keep its observable surface concise, since every state attribute is something the Orchestrator may observe
- never render opinionated children; recognize the children the author writes. Logic-free rendering of author-controlled content (a `<template>` clone, a fetched fragment, a third-party widget) is the narrow exception and must be the Adapter's stated purpose
- speak the person's protocols fully when it is an interaction Adapter: keyboard grammar, focus, ARIA state. An interaction Adapter that does not is incomplete, not a different kind of element

**Sub-adapters.** A family of tags is one Adapter whose protocol spans several nodes: `content-tabs` with `content-tabs-header` and `content-tabs-body`, `spa-manager` with `spa-route`. The root keeps the protocol's state coherent across the parts and may write them; parts adapt input at their own node and announce upward; they never manage the root. Families share a prefix so the relationship is visible in markup. Native precedent: `<details>` and `<summary>`.

**Two shapes, one role.** System Adapters are single nodes with a platform API on the far side (`provider-*`, `detect-*`, `service-worker`, `super-form`). Interaction Adapters are usually families with a person on the far side (`content-tabs`, `content-carousel`, `content-drawer`). Some bridge both — `spa-manager` bridges history and its routes, a native `<form>` bridges submission and its controls. The rules are the same; only the protocol differs. A rule reacts to State; an Adapter speaks a protocol the Orchestrator cannot.

**Native elements are Adapters.** `<input>` bridges the keyboard, `<img>` the network, `<a>` navigation, `<details>` / `<summary>` the disclosure protocol, `<dialog>` the top layer. Custom elements extend the same contract to protocols the platform does not cover yet, and should never replace what it does. Neutron is optional: an ASO application needs an Orchestrator, but its Adapters can be entirely native.

**Three customization surfaces.** Configuration attributes inform behavior before it instantiates; events report what happened or will happen; a cancelable default action lets a listener prevent what happens next. Taken together they follow the *template method* pattern expressed in markup: the Adapter owns the algorithm, the author controls the hooks.

**Capability bases.** A minority of Nucleus Kit elements are composed from shared contracts — `abortable`, `renderable`, `fetchable`, `listenable`, `routable`. Composition is opt-in. Most Adapters are standalone.

## State

> State is an application's living, structured, declarative body of data — the single source of truth - that is simultaneously what the application reads and presents.

State describes only the present. It holds no logic — it declares what is, never how anything happens. Structure, rather than flatness, is required - containment carries meaning, allowing the Orchestrator to scope and match its rules against this ancestry. This is what makes selector-based coordination possible.

Every part of it is addressable and serializable. Those are not conveniences of the web platform; they are requirements. Addressability is required for orchestration, and serializability is what enables inspection and lets a fully-formed State be shipped before any Adapter or Orchestrator exists.

It is observable and mutable by embedded Adapters (which write only their own regions) and by the Orchestrator (which coordinates across them). It is upgradeable in place: Adapters embed and hook into it rather than being rendered by it.

It has no exogenous derivation. Descendent parts of it may be computed from ancestor parts... that cascading is intentional. Nothing is derived from outside of it. Nothing more authoritative lives elsewhere.

It is singular per orchestration domain; encapsulation boundaries like shadow roots or iframes start a new State root with its own optional Orchestrator. They never reach across these boundaries.

Provisioned data — adapter-owned, published rather than authored — sits embedded as a region of State, rather than an exception to it.

### The unified surface

The State is both the source of truth & the presented artifact. This union is one of ASO's headline features, and the rest follows from it. A conventional pipeline (memory model -> logic -> render -> DOM) severs that unity and then spends its complexity budget repairing the seams: hydration, reconciliation, stale closures, effects. ASO never opens the seam. What the user sees can't disagree with what the application knows; they are the same object.

### Regions and ownership

Architectural distinctions are drawn by **write authority**, not data shape. Primitives vs rich data is a storage detail of the platform.

| Region | Owner | Web form | Readable by the Orchestrator |
| --- | --- | --- | --- |
| Initial state | The author | Elements, attributes, text | Yes — by selector |
| Provisioned data | The publishing Adapter | Rich `provision` on an element | Yes — by `prop("provision")` |

Provisions are published, not authored. A fetch response or a set of route params is owned by the element that produced it. `$variables` — declared by rules or written from JS through `element.quark.setProperty()` — are Orchestrator-owned working values anchored to elements; they are not selector-addressable, so a fact that CSS or a selector should see is reflected into an attribute instead.

### Consistency

Orchestrator writes are batched as a dedicated thread task; a given rule always reads synchronously-settled elements rather than a half-applied ones. Events are intentionally not batched: bubbling is synchronous, so listener (mid-bubble) must see the world as it is. Rules are idempotent - re-running one is harmless. Mutations of state via Adapters or the Orchestrator should be done as synchronous writes where coherence is important; async mutations are separate facts, and treating them as one is not the Orchestrator's job. Orchestrator rules and rule properties are matched/executed in the sequence they are defined.

### Origination

Initial State is usually authored statically, but need not be. The pattern does not prescribe where a State comes from, but once present, it's the sole authority.

## Orchestrator

> The Orchestrator is a declarative, selector-driven observer that watches State changes and writes coordinated changes back to it, holding no separate state of its own.

**Stateless.** Bindings live in State (on elements), shared across Orchestrator instances/sheets, the same way custom properties are, resolved by walking up ancestors. A sheet is pure behavior. Two sheets cooperate through the document without knowing the other exists; this follows CSS and the Blackboard pattern.

**Addressed, not invoked.** Rules name State locations by selector, never participants by real identity. The Orchestrator holds no reference to any Adapter... and no Adapter calls the Orchestrator. Coordination is anonymous in both directions.

**A deliberately narrow language.** Expressions may compute and read, they may not cause effects. Method calls, mapped to native JS, are limited to a read-only allowlist. The Orchestrator declares relationships between facts... anything imperative must leave through a custom, named module function, defined by the author. The architectural rule — "the Orchestrator does not execute procedures" — is enforced at the language level.

**Failure-inert.** A broken expression logs and no-ops, like CSS. Malfunction in the Orchestrator degrades the experience... it cannot corrupt the State.

**Reactive and bounded.** It observes only what its own rules reference (the underlying MutationObserver is filtered to the attributes its rules name, plus element insertions — and removals only while a rule's match depends on children or sibling position), and its authority stops at an encapsulation boundary.

**Classification.** The Orchestrator is not a finite state machine - it has no enumerable state set. Its configuration is the document. It has features of a **conceptual Statechart**, but is more precisely a **reactive extended state machine**: hierarchical (rules nest and can scope to ancestors), with guards (selectors), actions (writes), and extended state (the document and its bindings).

**Quark's divergence from CSS.**
Rules are applied as ephemeral transactions, not persisted. This is because, unlike CSS, the Orchestrator does not own its domain (the State). Anything can write an attribute outside its knowledge. This may change in a future version of Quark.
This means:
- Rules do not revert when their selector stops matching. Authors must write the inverse rule if they wish to un-apply the rule in question.
- Specificity is not taken into account. If Rule A matches before Rule B, but has a higher CSS selector specificity, it will not matter. Rule B will be applied regardless.

Quark is also a derivative of CSS rather than a superset of it. Rules, selectors and declarations carry over; the at-rules do not. Quark has its own ten (`@use`, `@scope`, `@on`, `@dispatch`, `@command`, `@view-transition`, `@delay`, `@warn`, `@debug`, `@error`) and rejects every other one at parse time instead of ignoring it.

## How it differs

**Component frameworks** (React and similar frameworks) put a memory model in charge, run it through custom app logic, and target the document as output. The component conflates view, orchestration, and adapter (and sometimes even styling) in one imperative unit, which is why composition and reuse are difficult. A parent cannot reshape a child's logic without forking it. ASO separates these three roles into three languages — HTML, Quark, plain functions — and deletes the memory model.

**MVC / MVVM** keeps a model separate from a view and spends its lifecycles synchronizing the two. ASO has one surface. There is nothing to bind.

**Nearest relatives** are the Blackboard pattern and CSS itself: see [Prior Art](/nucleus/docs/prior_art).
