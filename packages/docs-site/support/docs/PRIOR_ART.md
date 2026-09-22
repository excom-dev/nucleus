# Prior Art

ASO was worked out in practice, not derived from theory — but most ideas it contains already have a name. Those names let you reason about the architecture and borrow decades of thinking about its properties.

## Lineage

### Blackboard pattern

The closest ancestor. Knowledge sources in a blackboard system never talk to each other. They watch a shared, structured store (the blackboard), contribute when they recognize something they can act on, and a *control component* chooses what runs next. ASO maps onto that picture directly: the State is the blackboard, Adapters and rules are knowledge sources, and the Orchestrator is the control. Loose coupling, opportunistic problem solving, incremental solution-building — the blackboard literature's claims all apply here.

### Stigmergy

Biology's version of the same idea. Ants and termites coordinate by leaving traces in a shared environment; other individuals respond to those traces, with no direct communication. That is a useful lens for Adapters and sheets that cooperate without knowing the other exists — the document is the environment, attributes are the traces.

### Ports and adapters (hexagonal architecture)

Cockburn puts the application core at the center and reaches the outside world through adapters that translate both ways. ASO's first role takes its name from here. In ASO the document is that core and the Adapters are, literally, its adapters: `provider-fetch` adapts the network, `super-form` adapts user input, `content-tabs` adapts a person's tab-navigation protocol and the accessibility tree. Driving versus driven maps onto the two directions an Adapter carries updates. The capability bases (fetchable, listenable, routable, …) are adapter contracts.

### Statecharts

Harel's statecharts add hierarchy, guards, and extended state to finite state machines. The Orchestrator can be seen like a conceptual (non-visual) statechart, not an FSM: rules nest and scope by ancestry, selectors act as guards, writes are actions, and the document is the extended state. Calling it an FSM would imply an enumerable state set that does not exist.

### CSS

Quark is CSS-like in more than syntax. It inherits CSS semantics for scoping (`@scope`), cascade and inheritance (variables resolve up the ancestor chain, nearest wins, across sheets), and coordination by selector rather than by reference. Two deliberate departures: rules do not revert on unmatch — see [Limitations](/nucleus/docs/limitations) — and the at-rules are Quark's own, so `@media`, `@keyframes` and the rest are parse errors rather than CSS Quark carries along. Quark's JS-side variable API, `element.quark.setProperty()`, is modeled on `element.style.setProperty`.

### Smalltalk images

The unified-surface principle — the live system *is* the artifact, inspectable and serializable while it runs — has a lineage in Smalltalk's image-based environments, where no separate build product stands apart from the running state. ASO takes the same stance toward a web document.

### Template method

An Adapter's three customization surfaces — configuration attributes, events, and cancelable default actions — are the template method pattern expressed in markup: the Adapter owns the algorithm and exposes the hooks the author fills in.

### Native precedent

Letting listeners write into `event.detail` before a default action runs follows the platform's own `formdata`, `beforeunload`, and `respondWith` events. Booleans-as-attributes, `is-*` state, and tag-prefixed events extend conventions already present in HTML.

## A note on the name

"Adapter" is taken from ports and adapters and means the same thing here: the element that translates between the core — the document — and a protocol outside it, in either direction. The coordination literature to consult remains the blackboard literature; the participant literature is hexagonal architecture.

## Design patterns

ASO is not a re-cut of the Gang of Four taxonomy, but it is composed from its patterns the way the book's own introduction composes MVC from Observer, Composite, and Strategy. The State is a Composite — the document tree — whose serializability is a Memento. The Orchestrator is an Interpreter over that tree, coordinating as a Mediator and reacting as an Observer. Adapters are adapters in the structural sense, often Decorators of native elements (`super-*`) or Facades over a platform API, exposing their hooks through Template Method; `event-handler` is a Command invoker, and bubbling with cancelable default actions is Chain of Responsibility. Note what is absent: ASO assigns no creational pattern to the application — the platform parses and upgrades, the author writes the initial State — which is the no-components rule stated another way. One caution for GoF readers: ASO's *State* is the shared structure, not the behavioral State pattern; the closest thing to that pattern here is a Quark rule keyed on an attribute.

## Neighbors

Ideas ASO shares something with, and where the paths diverge:

- **Attribute-driven libraries** (HTMX, Alpine.js) also put behavior on HTML. HTMX's brain is the server: it swaps server-rendered fragments. Alpine embeds JavaScript expressions and component-like scopes in attributes. ASO keeps orchestration on the client, in a separate declarative language, with the document as the only state. It does not embed any foreign syntaxes into HTML.
- **Web component frameworks** (Lit and similar) use the same custom-element primitive but keep the component model: an element renders and manages its children from a template. ASO elements never do.
- **Flux / Redux / stores** centralize state outside the view and derive the view from it. ASO centralizes state *in* the view and nothing outside of it is treated as a source.
- **Elm / MVU** get predictability from a pure update function over an in-memory model. ASO gets it from declarative rules over a visible one.
- **MVC / MVVM** separate model from view and synchronize them. ASO has one surface and nothing to synchronize.

## What it is not

Not a virtual DOM. Not a component model. Not a store. Not a finite state machine. Not a build tool. It is a way of arranging responsibilities so the platform's own primitives — selectors, observers, custom elements, events, custom properties — can carry an application without a second copy of its state.
