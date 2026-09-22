# Core Concepts

The Nucleus Stack implements an application architecture named **ASO: Adapter, State, Orchestrator**. Three roles.

## The driving idea

**The live HTML document is the application's state.** Not a rendering of that state, and not a projection of it. Facts live in the document, and the document is also what the user sees. There is no separate memory model to keep aligned, because a second copy does not exist.

Everything else follows from that.

## The three roles

### Adapters

An Adapter is an element that bridges the State and one protocol outside it — a server, a sensor, a store, or the person using the page. It carries that protocol's state as attributes on itself, announces what happens through events, and leaves all coordination to the Orchestrator.

```html
<provider-fetch api-url="/api/user"></provider-fetch>
```

`provider-fetch` bridges the network. Lifecycle shows up as attributes (`is-loading`, `is-success`, `is-error`); the response is published as data; events fire. It does not decide what happens next. It knows about nothing else.

Some native elements are Adapters as well. `<input>` bridges the keyboard: it owns its pseudoclasses like `:valid` and fires events like `change`. `<form>` bridges submission: it validates and fires `submit`. Nucleus Stack Adapters, through the Custom Element API, simply extend that same contract to protocols the platform does not cover yet.

### State

The State is the document: every element, attribute, and text node, plus the rich data some Adapters publish on themselves. Three properties let it function as state:

- **Structured** — nesting carries meaning. Rules scope themselves by ancestry.
- **Addressable** — any part can be named with a selector.
- **Serializable** — the whole thing can be written out, inspected, and shipped fully formed.

Anything you would put in a store belongs on an element instead: `<main data-mode="edit">`, `<li data-done>`, `<dialog open>`.

### Orchestrator

The Orchestrator watches the State and writes the State. In this stack that role is **Quark**, a CSS-derived language of rules:

```quark
main[data-mode="edit"] [bind-toolbar] { content: template("#edit-tools"); }
main:not([data-mode="edit"]) [bind-toolbar] { content: none; }
```

A rule names a condition (a selector) and the writes to perform while that condition holds (attributes, content, listeners, variables). The Orchestrator stores no state of its own. Whatever it knows, it reads from the DOM; whatever it decides, it writes back.

## The loop

1. An Adapter does its job — something happens on its protocol — and reflects the result on itself as an attribute or event.
2. The Orchestrator notices the change and applies matching rules, writing into other parts of the document.
3. Those writes drive other Adapters, which act on their protocols and reflect results. Those writes can also notify other relevant Orchestrator rules.
4. Repeat until the document settles.

Nothing directly calls anything else. Adapters hold no references to one another. The Orchestrator holds no references to Adapters. Coordination happens entirely through what is visible in the document.

## No components

This stack has no component concept. Like the native platform, elements are generic Lego pieces, not custom bricks: they have no intrinsic knowledge of any other elements outside of their own family, so you compose them the way you compose native HTML.

When you need a reusable chunk of UI with its own behavior, you write a **view**: an HTML fragment that optionally carries its own CSS and Quark sheet, loaded where you need it by `include-content` or `spa-route`. Views belong to you. Elements stay generic.

## Where the JavaScript goes

Most pages need none. When rules outgrow expressions, a sheet imports a module and calls its functions:

```quark
@use "/utils.js" as utils;
[bind-total] { content: utils.formatCurrency($cart.total, "USD"); }
```

Functions should be pure: take values, return values. Side effects are allowed when they cannot be avoided, but they stay rare in practice, because the document already holds the state a side effect would otherwise manage.

## Quick reference

| You want to… | Reach for |
| --- | --- |
| Bridge a protocol — a browser API, a store, a person's interaction (tabs, drawers) — configurably | A **Nucleus Kit element** |
| React to state, bind data, render lists, wire an event | A **Quark rule** |
| Compute or format a value | A **pure function** via `@use` |
| Style something | **CSS / Valence.css**, keyed to state attributes |
| Package a chunk of UI | A **view** (HTML + CSS + Quark) |

Continue with [Using Elements](/nucleus/docs/using_elements) and [Orchestrating](/nucleus/docs/orchestrating). For the full architectural treatment, see [Adapter, State, Orchestrator](/nucleus/docs/adapter_state_orchestrator).
