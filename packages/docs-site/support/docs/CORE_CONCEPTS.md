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

Most pages need none. When a calculation outgrows Quark expressions, the sheet imports a module and calls its functions:

```quark
@use "/pricing.js" as pricing;
[bind-total] { content: pricing.total($items, $tax-rate); }
```

A module should be pure business logic: it takes values and returns a value. It is also the exit for anything Quark cannot yet declare. Bridging a protocol, such as the network, storage, the clock or a person, belongs to an Adapter. Quark leans that way on purpose: it calls module functions synchronously and does not await what they return, so a fetch inside a module is deliberately awkward. A function may build and return a node it owns, such as a chart; it should still leave the document around it alone.

## Quick reference

| You want to… | Reach for |
| --- | --- |
| Bridge a protocol — a browser API, a store, a person's interaction (tabs, drawers) — configurably | A **Nucleus Kit element** |
| React to state, bind data, render lists, wire an event | A **Quark rule** |
| Compute or format a value | A **pure function** via `@use` |
| Style something | **CSS / Valence.css**, keyed to state attributes |
| Package a chunk of UI | A **view** (HTML + CSS + Quark) |

## Next steps

- [Quick Start - A working page, in five minutes.](/docs/quick_start)
- [Core Concepts - The mental model, in one sitting.](/docs/core_concepts)
- [Using Elements - The Nucleus Kit catalog and how elements behave.](/docs/using_elements)
- [Orchestrating - Get familiar with Quark.](/docs/orchestrating)
- [Styling - Valence.css themes, tokens, and state-driven CSS.](/docs/styling)
- [Building Views - Structure a real app: routes, views, lazy loading.](/docs/building_views)
- Other Guides - [Business Logic](/docs/business_logic), [Creating Elements](/docs/creating_elements), [Best Practices](/docs/best_practices), [Troubleshooting](/docs/troubleshooting), [Debugging with Agents](/docs/debugging_with_agents)
- [Diving Deeper - The architecture behind it all, for the curious and the skeptical.](/docs/diving_deeper)
