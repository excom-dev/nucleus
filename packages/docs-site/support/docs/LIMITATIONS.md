# Limitations

Below are the costs the Nucleus Stack currently accepts, stated directly, with the rationale for each and the practical response. Some limitations are temporary, some permanent, some by-design.

## May or may not play well with others

Works very well with all Custom Elements that follow the [Adapter](/nucleus/docs/adapter_state_orchestrator) pattern. They do not need to be constructed by Neutron. You can even import Quark by itself into your own Custom Element project, if that suits your fancy.

Nucleus Stack apps can always render other UI frameworks, not always the other way around:

Nucleus is not out-of-the-box compatible with certain other UI frameworks/libraries that lock the DOM to their own internal state, such as React. Many of these frameworks treat the DOM as a compilation target, not the source of truth as Nucleus does. Therefore, any changes Nucleus elements or Quark make to the DOM will be seen as "unreconciled" by the other framework and will be obliterated. If you seek to integrate the Nucleus Stack into an app of another UI framework, that framework MUST either allow untracked DOM changes, or you must use a Shadow DOM as a boundary between it and the Nucleus stack.

## Quark rules don't revert

The instant a CSS selector stops matching, the rule unapplies. Quark never does this. Attributes, content, listeners, variables, and CSS variables remain until some later rule overwrites them.

*Why.* The Orchestrator is not the owner of the document. An element, a script, or the user can write an attribute Quark doesn't own. Claiming a rule can be cleanly "unapplied" would overstate what Quark can promise. There is a real technical cost as well, but architectural honesty is what decided it.

*What to do.* For every state you leave, write the inverse rule. A future version may add reversion; do not build on that possibility.

## Writes are batched; events are not

Writes from the Orchestrator are gathered and flushed as a batch, so rules always read a settled element — and, as a result, writes are not aligned to frames. Events fire immediately and are never batched, because bubbling is inviolable: a listener still mid-bubble must be able to call `preventDefault()` or `stopPropagation()` against the actual world.

*Consequence.* Per-frame values are not a Quark job. Name the destination state and let CSS transitions, view transitions, or the Web Animations API own the motion. An animation describes change over time; State describes only the present, so animation has no place there.

`@view-transition` is the one place a write waits for the renderer: its writes land a rendering opportunity later, inside `document.startViewTransition()`. A document runs one view transition at a time — a route transition and a Quark one in the same moment cannot both animate, and Quark commits unanimated by default while another is active. `until` keeps the old state frozen on screen and delays the new capture, so use it for short waits, never for a fetch. Two elements sharing a `view-transition-name` abort the animation (the writes still land). Scoped, per-element transitions are not available yet in browsers, but this feature will likely utilize it in the future.

Element insertions under a sheet's host are observed whoever makes them, so a widget that rebuilds its DOM every frame inside a host costs a rule pass per frame. Give such a widget a shadow root or an iframe, which Quark never enters.

## The DOM is proportional to your data

Any item that takes part in orchestration has to exist as an addressable node. Pairing `iterate()` with `include-content lazy-load` keeps each row's *cost* near zero until it enters the viewport, which is comfortable into the thousands. True virtualization — a recycled pool of rows windowed over a dataset — keeps node count proportional to the *viewport*; the out-of-the-box implementation does not do that. At six figures of rows, node count itself is the wall.

*What to do.* Page or filter within Quark before the iteration hits the document.

## No replay of past events

If a sheet registers after an Adapter has already fired its connect-time events, those events are gone. Quark does not record or replay past events or past states on purpose: a replayed event cannot honor `preventDefault()` or `stopPropagation()`, so the replay would be a weaker, different event wearing the original's clothes.

*What to do.* Load sheets before the Adapters they listen to. Put `<quark-sheet>` first in its host. Prefer state attributes (`is-success`) over one-shot events for anything that can fire during boot. Attribute-driven rules are always safe, because the first run reads the settled document.

## Native form state is only half in the document

The platform keeps a form control's *default* in markup (`value`, `checked`, `selected`, a textarea's text) and its *live* state in JS properties that stop following the markup once the user touches the control. Quark hides the write half: an attribute a rule writes on `<input>` / `<option>` / `<textarea>` is pushed into the live property too, so the attribute stays authoritative and serializable. The read half stays with the platform: typing never updates an attribute, and the Orchestrator does not observe it. Reflect what you need through events (an `@on input { … }` block, `super-input reflect-value`) and select on that. A serialized document therefore holds what rules wrote, not what the user has typed since.

## Quark selector coverage & performance (in Beta)

Quark selectors do not observe state the DOM does not reflect: interaction and validity pseudo-classes (`:hover`, `:focus`, `:checked`, `:invalid`).

`:is()` / `:not()`, `:has()`, sibling combinators and structural pseudo-classes (`:nth-child()`, `:empty`) *are* observed, with two partial cases: `:empty` ignores text-only changes, and sibling-relative `:has(+ …)` / `:has(~ …)` re-runs the whole rule from the host.

`:has()` also costs a native subtree scan per candidate on every fan-out that includes the rule, so keep its arguments shallow and devoid of selectors that match many elements.

Classes and ids are observed, but setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance: a sheet that names any class wakes on every class change under its host and compares class lists to find the ones it uses (`[class~="x"]` and `attr("class")` skip that filter and re-run on every change).

## Boundaries are absolute

A shadow root or iframe opens a new State root, with its own Orchestrator. Quark never crosses that line, any more than CSS does. That is what makes isolation trustworthy for embedded widgets, and it is also why the stack avoids shadow DOM by default: a boundary is a wall in both directions.

## Nobody truly owns the document

Ownership in this ASO implementation is a discipline, not an enforcement. An element that writes a sibling's attribute will not be stopped. Rules are idempotent so that re-runs from unexpected writers stay harmless, but correctness still depends on participants honoring their regions.

*What to do.* Follow the Adapter contract. Keep script out of the state-writing business except through rules and elements. The inspector will show you if something is misbehaving.

## Runaway loops are cut, not prevented

Nothing stops you from writing two rules, two effects, or a rule and an element that keep re-triggering each other. What the stack does is bound the damage: every write an engine makes carries the depth of the chain that caused it, and the hop that would exceed `LoopGuard.limit` (50, from `@excom/kit-utils`) is dropped and reported once — in the console and, with DevTools attached, as an orchestration error naming the element and attribute. The document keeps the state it had before the dropped write. A chain restarts at zero on every external write (user input, a timer, a fetch, app JS in a later task), so a stream of updates never trips, however long it runs.

*Consequence.* A loop costs up to 50 passes before it dies, and the state it leaves behind is wherever the cycle happened to be. Writers the engines do not route — plain `setAttribute` or `innerHTML` in app JS — neither count nor get cut; a cycle made only of those is invisible. Rules that gate on attributes they write for each other are named in a build-time warning. Treat that and a "Loop guard" message as bugs to fix, not behavior to rely on.

## Commands need the Command API

Elements accept their imperatives as native `command` events (`<button command="--fetch" commandfor="…">`). That API is Baseline 2025 (Chrome 135, Firefox 144, Safari 26.2); older browsers ignore a `commandfor` button. `<event-handler command-name>`, `<dismiss-watcher command-name>` and script-built commands work everywhere, because the stack dispatches custom commands itself; only the built-in verbs (`show-modal`, `toggle-popover`) need the platform. Ship a Command API polyfill for older browsers, or use `<event-handler>` where it matters.

## Beta maturity

Quark is in beta. One item above (reversion) may change. Element APIs are stable in shape — attributes & commands in, events out — but individual packages evolve. Pin versions.

Some features will be broken for certain browsers whose versions are older than a year (mainly Firefox & Safari, mid-2025). This will be remedied in the first stable release.

## When not to use it

- Per-frame animation, canvas or WebGL-heavy scenes, and anything whose state is not naturally documentary.
