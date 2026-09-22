# Glossary

One definition per term. Capitalization marks a term that names one of the three ASO roles.

**Adapter** — A located element (or family of elements) that bridges the State and one foreign protocol — a system or a person — carrying the protocol's state as attributes and provisions, its occurrences as events, and its other machinery privately. On the web: a custom or native element.

**ASO** — Adapter, State, Orchestrator. The application architecture implemented by the Nucleus Stack.

**Addressability** — Any part of the State can be named. On the web, by a CSS selector. A precondition for orchestration.

**Binding** — A `$variable` value a Quark rule stores on an element, readable by that element and its descendants, across sheets.

**Catalyst** — Whatever originates change: a user action, a network response, a timer. Adapters originate change; rules respond.

**Closed under derivation** — Every fact in the State traces back to somewhere else in the State, with computation allowed in between. Nothing originates outside it.

**Command** — An imperative aimed at one element, carried by the platform's `command` event (`CommandEvent`): non-bubbling, cancelable, with a `--verb` name (`--submit`, `--reload`) and a `source`. Invoked by `<button command commandfor>`, `<event-handler command-name>`, or script; handled with Neutron `onCommand`. Not State (it describes no fact) and not an announcement.

**Content** — In Quark, the `content:` property: text, a cloned `<template>`, a fetched fragment, an iteration, or trusted HTML.

**Default action** — What an element does after firing a cancelable event unless a listener synchronously calls `preventDefault()`. The escape hatch for customizing an Adapter without forking it.

**Effect** — In Neutron, the plain object (or array of objects) a lifecycle or method returns, describing what should happen (prop values, `emit`, `style`, listeners) instead of mutating the element directly.

**Element base** — A composable Neutron builder that encodes a shared contract (`abortable-element`, `fetchable-element`, `renderable-element`, `listenable-element`, `routable-element`). Opt-in.

**Family** — A root Adapter plus its sub-adapters, sharing a name prefix: `content-tabs` / `content-tabs-header` / `content-tabs-body`.

**Host** — The parent element of a `<quark-sheet>`. The sheet's rules match only inside it, unless `is-global` attr is set. The host itself is reachable via `:scope`.

**Iteration** — `iterate(array or object)`: stamps one copy of an element's `<template>` per item, exposing `item` and `index` to rules.

**Neutron** — The declarative factory for building custom elements as Adapters. Optional; an ASO app can use only native elements or other Custom Element constructors, so long as the elements themselves adhere to the Adapter definition.

**Neutron element** — Any custom element built with the Neutron factory, whether it ships in Nucleus Kit or the app author wrote it.

**Nucleus Kit** — The package that bundles the whole stack behind one import: `nucleus-kit`.

**Nucleus Kit element** — One of the drop-in custom elements in the Nucleus Kit catalog (`content-drawer`, `super-form`, `spa-route`, …). Each is also published on its own.

**Nucleus Stack** — The whole combination: Nucleus Kit elements + Neutron + Quark + Valence.css + Nucleus DevTools, published as `@excom/*`.

**Option attribute** — An attribute the author sets to configure an element (`api-url`, `lazy-load`).

**Orchestrator** — A declarative, selector-driven observer that watches the State for changes and writes coordinated changes back into it, holding no state of its own. On the web: Quark.

**Protocol** — What an Adapter bridges to the State: a system (network, storage, sensor, clock, history, viewport) or a person (pointer, keyboard, focus, the accessibility tree). One protocol per Adapter.

**Provision** — Rich data an Adapter publishes on itself (a parsed response, route params). Adapter-owned, published rather than authored. Read in Quark with `prop("provision")`.

**Pure function** — A JavaScript function that takes values and returns values without side effects. The preferred shape for everything imported via `@use`.

**Quark** — The CSS-derived orchestration language and runtime. Sheets of rules that select elements and write attributes, content, listeners, and variables.

**Recognized elements** — The descendants an element wires up automatically (`super-form` recognizes your `<form>`). Listed on each package page.

**Rule** — A selector plus declarations. Runs whenever a matched element's referenced attributes or bindings change. Does not revert on unmatch.

**Rule reversion** — CSS behavior in which a declaration stops applying when its selector stops matching. Quark does not do this; write the inverse rule.

**Scope** — The subtree a sheet may affect. Sheets are implicitly wrapped in `@scope { }` anchored at the host; `is-global` opts out.

**Serializability** — The whole State can be written out and shipped fully formed. A requirement, not a convenience.

**Quark Sheet** — A `<quark-sheet>` (inline or `src-url`) or a programmatic `Quark` instance: one unit of orchestration.

**`element.quark`** — The JS side of `$variables`: `setProperty` / `setProperties` / `removeProperty` / `getPropertyValue` on any element, shaped like `element.style`. The element written to becomes the binding's owner.

**State** — An application's living, structured, declarative body of data — the single source of truth - that is simultaneously what the application reads and presents. On the web: the document.

**State attribute** — An attribute an element writes about itself (`is-loading`, `did-fail`, `has-rendered`). What CSS and Quark select on.

**Sub-adapter** — A dependent part of an Adapter family that cannot operate alone. It adapts input at its own node and announces upward; the root keeps the family's state coherent and may write it.

**Super element** — A `super-*` element that wraps and upgrades a native element the author still writes (`super-form`, `super-input`).

**Tag alias** — A `.tag-*` class in Valence.css that lends a native tag's look to any element (`<my-card class="tag-article">`). Every alias has a matching ARIA role; prefer the role.

**Template method** — The architectural pattern behind an Adapter's customization surfaces: the Adapter owns the algorithm; attributes, events, and default actions are the hooks.

**Unified surface** — The State is simultaneously the source of truth and the presented artifact. ASO's headline property.

**Valence.css** — The stack's semantic, classless CSS with `--v-*` tokens, `[data-scheme]` light/dark, role and tag aliases, and opt-outs. Proud fork of the brilliant Pico.css.

**View** — An HTML fragment that owns its CSS and its Quark sheet, loaded by `include-content` or `spa-route`. The stack's replacement for components; always the app author's, never shipped with the stack.

**`@use`** — Quark's module import statement: `@use "/utils.js" as *;` exposes a module's exports to sheet expressions and event handlers.
