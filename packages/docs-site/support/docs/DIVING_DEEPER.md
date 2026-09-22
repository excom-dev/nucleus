# Diving Deeper

This section is for technically curious deep-divers. It explains *why* the Nucleus Stack/ASO is shaped as it is, names the ideas it stands on, and is candid about what it forgoes.

## Reading order

1. [Origin Story](/nucleus/docs/origin_story) — why Quark exists, and the platform gap it fills.
2. [Adapter, State, Orchestrator](/nucleus/docs/adapter_state_orchestrator) — the pattern, defined precisely.
3. [Prior Art](/nucleus/docs/prior_art) — where the ideas overlap and descend from existing ones, and what ASO is not.
4. [Limitations](/nucleus/docs/limitations) — the edges, the divergences, and the unresolved bits of this implementation
5. [Glossary](/nucleus/docs/glossary) — every term - one definition each.

## Design principles

**HTML is primary; JavaScript is a guest.** A conventional stack puts a JavaScript memory model in charge and targets the document as its compiled output. ASO upends that. The document *is* the program's state, elements embed into it, and optional scripting is invited in as pure functions once rules run out of expressiveness.

**The unified surface.** What the application reads and what it presents are the same artifact. Other frameworks' pipelines — memory model, logic, render, DOM — is exactly the severing of that unity, and everything required afterward (hydration, effects, reconciliation) exists to repair it. ASO never severs it.

**Distinctions are drawn by ownership, not by data.** Whether a value is a primitive attribute or a rich object is a storage detail of the host platform. Architecturally, what matters is who may write it: the author, the element that owns it, or the Orchestrator.

**Single responsibility is a constraint, not a preference.** An element with two jobs must be two elements. That is what makes composition work w/o a component model.

**There are no components.** Elements have no intrinsic knowledge of any other elements outside of their own family. Reusable UI is a *view* — markup plus its own CSS and Orchestrator sheet — loaded where needed. Nothing that ships with the stack decides what your page looks like.

**Coordination is anonymous and addressed by location.** Rules name places in the document with selectors. No participant holds a reference to another; none calls another. That is what lets two sheets cooperate without knowing the other exists. This follows CSS and the Blackboard pattern.

**State describes only the present.** No logic, no history, no futures. Animation belongs to CSS.

**Failure is inert.** A broken expression logs and does nothing. Malfunction in the Orchestrator degrades the experience; it cannot corrupt the state.

**The platform is the framework.** Selectors, mutation observers, custom elements, events, custom properties, view transitions. The stack adds a language - which is simply a derivative of CSS - and an optional factory over those primitives.

## One paragraph per role

An **Adapter** is a located element — or a family of elements — that bridges the State and a foreign protocol: a system (network, storage, sensors, the clock, history, the viewport) or a person (pointer, keyboard, focus, the accessibility tree). It carries the protocol's state as attributes and provisions on itself, its occurrences as events, and its non-State machinery privately.

**State** is an application's living, structured, declarative body of data — the single source of truth - that is simultaneously what the application reads and presents.

The **Orchestrator** is a declarative, selector-driven observer that watches State changes and writes coordinated changes back to it, holding no separate state of its own.

Continue to [Adapter, State, Orchestrator](/nucleus/docs/adapter_state_orchestrator).
