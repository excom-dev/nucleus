# Best Practices

Short rules with rationale. They exist because the document *is* the state — keep that document honest and the rest stays simple.

## HTML

- **Semantic first.** `article`, `header`, `nav`, `figure`, `details`, etc. Avoid `div` soup. This will make it easier to hook into with Quark and CSS.
- **Classes carry static flavor only.** `details.accordion` is fine; `.is-open` is not. Dynamic state belongs in attributes: use an ARIA or `data-` attribute if the element does not provide the proper attribute.
- **Ids only where uniqueness is guaranteed.** Anything that might be iterated.
- **Use native state before inventing state.** `[open]`, `:valid`, `[aria-current]`, `[disabled]`.
- **Put state on elements, as attributes.** If you wish to store data somewhere, put `data-*` on the nearest sensible ancestor instead.

## Quark

- **Match on attributes rather than classes or ids that change.** Setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance.
- **Write the inverse rule.** Rules do not revert when they stop matching. Every state you leave needs a counter-rule (current limitation).
- **One sheet per view, first child of its root.** Registers before siblings connect; scope stays tight.
- **Binding identifiers.** You may need to target many parts of the document with your Quark rules in order to render content/attributes. If you choose to reserve classes for styling only, use logical, unused attribute patterns for data binding, such as `[bind-title]` or `[bind-field="title"]`.
- **Prefer nesting and facts over long combinator chains.** `>`, `+`, `~` and `:has()` are observed, but a deep chain couples a rule to markup structure; nest rules and select on attributes instead. Avoid over-nesting, since this is also brittle.
- **Namespace variables.** `$app-theme`, `$cart-total`. Like CSS, bindings are shared per element across Quark sheets.
- **Raise state on the owner.** A `$variable` written on a descendant shadows the owner's; put the `@on` block on the owner rule (`target:` for delegation) or call `element.quark.setProperty()` on the owner from JS. One writer per name per element.
- **`preserve` while loading.** `content: $todo.title or preserve;` keeps the last good value instead of flashing empty.
- **Never render what you match.** A rule that renders children (via `content:`) that match its own selector re-triggers itself until the loop guard cuts it (50 nested paints, logged as `Loop guard: …`).
- **Don't let rules gate on each other's writes.** `[data-a="1"] { data-b: "1"; }` next to `[data-b="1"] { data-a: "2"; }` is a cycle: Quark warns when the sheet builds (*rules gate on attributes they write for each other*) and the loop guard cuts it at run time if it never settles. Give the transition one attribute with a value, derive the second fact from the first in one direction only, or gate one side on a guard attribute. A rule cannot loop on the attribute it writes itself — that write never re-runs the same declaration.
- **Do not use variables to smuggle side effects.** An unused `$x: doThing();` is an element and an event in disguise.
- **Put the fact in the document before branching on it.** `if()` is fine, but many rules testing the same condition (`if($user.role == "admin": …)`) mean a fact is missing from the State. Write it once as an attribute (`data-is-admin: $user.role == "admin";`), then select on it: `[data-is-admin] button { … }`. The condition becomes declarative, addressable by CSS as well as Quark, visible in devtools, and evaluated in one place.
- **Prefer interpolation over concatenation.** `"Items: #{$n}"` and `"/api/users/#{$id}"`, not `"Items: " + $n` or `"/api/users/" + $id`. `+` stays for arithmetic.

## Custom JS (Quark Modules)

- **Little to none for simple apps.** Elements and Quark rules cover most needs; when they don't, that is usually a missing element or rule, not missing script.
- **Built-in modules first.** `@use "quark:list"`, `quark:math`, `quark:string`, `quark:map`, `quark:date`, `quark:url`, `quark:util` cover the derivations views need (sorting, counting, plurals, clamping, dates, query strings); write a module function only for what they lack.
- **Keep functions pure** Side effects are permitted when unavoidable; in practice they are rarely needed because the document already holds what a side effect would manage.
- **No build step required.** Serve files as-is. Add a bundler only when you have a reason.
- **TypeScript is optional.** For a few dozen or hundred lines of pure functions, it usually isn't worth the build process.

## Events

- **Use the proper listeners.** Use Quark `@on` or custom elements like `<event-handler>` to listen to events, since they have a safe teardown procedure. Avoid using raw JS, which does not.
- **Invoke elements with commands.** A plain `<button type="button" command="--open" commandfor="id">` drives an element with nothing in between; `<event-handler command-name target-ref>` or a `@command` in an `@on` block does the same from any event or relative selector. Put `type="button"` on command buttons inside forms so they never submit.
- **Wire glue in the sheet.** Retargeting, keyboard shortcuts, debouncing and custom payloads are `@on` options, and `@dispatch` / `@command` inside an `@on` block relay the event onward — `<event-handler>` offers the same as attributes for markup without a sheet.
- **Delegate.** Events bubble; one rule on a common ancestor beats a listener per element — `@on click (target: "li[data-id]")` names the row and exposes it as `target`.
- **Cancel default actions with `preventDefault()`,** don't fork the element.
- **Don't expect changing attributes to fire events.** State describes; events announce. Keep them distinct.

## Building Elements

- **Avoid Shadow DOM** ASO applications are heavily data-driven. Shadow DOMs are a hard boundary and severely blunt the power of Quark and CSS. Instead, consider using `@scope`.
- **Single responsibility.** One job, configurable, observable. See [Creating Elements](/nucleus/docs/creating_elements).
- **Generic** `<content-drawer>` is good, `<add-to-cart>` is bad. Business logic belongs to Quark and its modules.
- **Never render children.** Composition is the design. The only caveat: an element may render fully author-controlled chilren, such as `<include-content>` does because this does not hinder composition.
- **Own your region.** An element writes only its own attributes and is permitted to write its [sub-adapters'](/nucleus/docs/adapter_state_orchestrator) attributes. Coordination across elements belongs to Quark sheets. Nothing else writes state.
- **Phrase booleans as assertions.** `is-loading`, `did-succeed`, `has-rendered`, `should-fetch`.
- **Dashed attributes, tag-prefixed events (`my-element-change`, never `change`).** This is to prevent collisions with native attributes and events - now and in the future.
- **Imperatives are commands, not events.** Accept "do this" as a `command` event with a short `--verb` (`onCommand("--submit")`), never as a bubbling `my-element-trigger` custom event. Commands are addressed to one element and never bubble, so the verb needs no tag prefix.
- **Underscore private members.** Minimize unnecessary imperative API surface.
- **Destructure the element in lifecycles.** `({ isOpen }) => ({ … })`, not `(el) => …` — a handler that only names the values it reads visibly cannot mutate the element imperatively. Destructured values are snapshots, so an async callback that needs current state should be a `defineMethods` method (it destructures fresh arguments when it runs).
- **Loosely couple** Avoid retaining hard references to other elements. When necessary, use `WeakRef` or ensure reliable cleanup during the proper lifecycles. Detached nodes make for significant memory leaks.

## CSS

- **Heavily utilize state attributes in selectors.** `provider-fetch[is-loading]`, `li[data-done]`, `[aria-expanded="true"]`.
- **Modern CSS is encouraged.** Nesting, `@scope`, `:has()`, container queries, view transitions.
- **Animate with CSS.** Declare the target state; let transitions and view transitions do the motion. Reach for Quark's `@view-transition` only where CSS transitions cannot go — rows that leave, list reflow — and keep `until` waits short.
- **Valence.css: Prefer roles to classes when borrowing a look.** `role="button"` over `class="tag-button"`.
- **Valence.css: Use tokens** (`--v-*`) so themes and schemes reach your views.

## Anti-patterns at a glance

| Smell | Fix |
| --- | --- |
| Toggling `.active` classes from a handler | Set an attribute; let CSS and Quark select on it |
| A Quark sheet variable that's never read | Move the effect to the event that causes it: an `@on` block with `handle:` or `@dispatch`. Consider `<event-handler listen-for-lifecycle="connected">` for a connect-time effect. |
| Two attributes flipped one after another to mean one thing | Prefer single attribute with a meaningful value |
| A custom element that reaches into a sibling or parent | Fire an event; let a rule coordinate |
| A bubbling `my-element-trigger` event that means "do this" | Accept a `--verb` command (`onCommand`); invoke it with `<button command commandfor>` |
| A `*-scroll-to` / `*-then-do-x` attribute on an element | Fire the event; compose with `<scroll-into-view>` or a rule |
| Shadow DOM "for encapsulation" | Light DOM plus scoped Quark / CSS |
| The same `if()` condition repeated across rules | Derive one attribute (`data-is-admin`, `data-is-eligible`) with a rule; select on it from Quark and CSS |
| `"Hello " + $name` / `"/api/" + $id` | `"Hello #{$name}"` / `"/api/#{$id}"` |
