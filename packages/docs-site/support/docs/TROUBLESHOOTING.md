# Troubleshooting

Symptom first, then cause, then fix. Nearly every problem comes from one of three places: a rule that does not match what you think it does, a change Quark cannot see, or timing at startup.

## A rule doesn't run

**It's outside the host.** A sheet matches only strict descendants of its parent element. Move the sheet, target the host with `:scope`, or use `is-global` if the rule truly must reach the whole document.

**It targets the host without `:scope`.** `section { … }` inside a sheet whose host is that section will not match it. Write `:scope { … }`.

**It uses an unobserved selector.** Interaction and validity pseudo-classes (`:hover`, `:focus`, `:checked`, `:invalid`) and pseudo-elements are not observed — the rule matches on its first run only, and the console shows a Quark warning at build. Hook element state instead: `dialog:not([open])`, `[aria-expanded="true"]`. `:has()`, sibling combinators and `:nth-child()` are observed and need no workaround.

**The referenced variable doesn't exist on an ancestor.** `$name` resolves upward from the consuming element. Confirm the declaring rule matches an ancestor (or the element itself), and that the name is spelled identically, including namespace.

**A nearer binding is shadowing.** When two rules write `$theme` at different depths, the nearest ancestor wins. Use `unset` on the inner one to fall through, or namespace them.

## A rule ran once and never again

**You read a class or id through `element` or `closest()`.** Those reads are not observed. Name the class or id in the selector (`li.is-done`, `#main`) or read it with a literal `attr("class")`. Setting attributes is still recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance.

**You changed a JS property, not an attribute.** In selectors, only attributes are observed. Reflect the value with `setAttribute()`, or read it in an expression with a literal `prop("x")` — that subscribes to JS assignments of `x`.

**The rule is reading a provision that hasn't re-published.** `prop("provision")` re-runs when the provider assigns a new provision. Confirm the provider actually refetched (the `--fetch` command, a changed `api-url`, or `is-paused` removed).

## Something stays set after its rule stopped matching

That's by design: **rules do not revert.** Write the counter-rule for every state you leave.

```quark
details[open] { --border: "red"; }
details:not([open]) { --border: "transparent"; }
```

## Content flashes empty while loading

The expression resolved to `null` / `undefined`, which wipes the target. Keep the last good value with `preserve`:

```quark
#title { content: $todo.title or preserve; }
```

## "Loop guard: …" in the console

Two participants keep re-triggering each other and the stack cut the chain. Causes, in order of likelihood:

- two rules that flip each other's attributes or classes (`a` sets `x` when `y`; `b` sets `y` when `x`). Give the transition one attribute with a value.
- an element effect that writes an attribute a rule reacts to, and the rule writes the attribute the effect reacts to.
- an attribute change fires an event (`dom-observer`, an element's `-change` event) and the listener — an `@on` block, an effect — changes that attribute again.
- a rule rendering elements its own selector matches, which re-triggers the rule (see below).

Every write an engine makes carries the depth of the chain that caused it; the write that would be hop 51 (`LoopGuard.limit`) is dropped, logged once with the element and attribute, and published to DevTools as an orchestration error. That is all that happens: no event fires, no attribute is wiped, no sheet or element is disabled, and the app is not told beyond the console line (subscribe with `LoopGuard.onTrip()` if it needs to know). The document keeps the state it had before the dropped write — but the participants are wherever the cycle left them, so treat the message as a bug report, not a fix. Start from the named attribute: what writes it, what reacts to it. Then let the reaction converge (a write of the value already there is skipped), give the transition one attribute, or gate one side on a guard attribute. Rules that gate on attributes they write for each other are also warned about when the sheet builds.

A rule cannot loop on its own attribute: a declaration is never re-run by the attribute it wrote. `class:` is the exception — its classes are separate facts, so `.is-done { class: (is-struck: true); }` applies when `is-done` arrives — and a class cycle is cut by the guard. Effects that keep re-queuing themselves inside one element are cut the same way, after `LoopGuard.limit` runs in one batch. `LoopGuard` (`@excom/kit-utils`, also `Neutron.DOM.LoopGuard`) exposes `limit`, `configure({ limit, log })` and `onTrip()`.

## The page freezes / "Maximum call stack"

A rule is rendering elements its own selector matches, which re-triggers the rule.

```quark
/* BAD */ span { content: template("#span-tmpl"); }
```

The loop guard stops this after 50 nested paints, but the fix is the selector: match the container or a `bind-*` attribute instead, and keep template children out of the selector's reach with a dedicated attribute or a nesting-guarded selector (`section:not(section section)`). A freeze the guard does not catch comes from writers it cannot see — plain `setAttribute` / `innerHTML` in app JS feeding each other — or from a loop with no DOM write in it at all.

## An event fired but nothing listened

**It fired before the sheet ran.** Sheets loaded via `src-url` or with `@use` imports don't run until those resolve. Place the sheet first in its host, prefer inline text for boot-time listeners, or react to a state attribute (`is-success`) instead of the one-shot event.

**It doesn't bubble that far.** Check the element's package page for the event's flags. Native events like `submit` are not composed, so they never cross a shadow root. Some events do not bubble at all.

**The handler name is wrong.** `@on click (handle: handleClick);` refers to an export of a module imported with `@use`. Check the export name and the `as *` / `as name` namespace.

## An element ignores its attributes

**Set before upgrade with a property.** If script ran before the element's definition loaded, `el.someProp = x` is lost. Use `el.setAttribute("some-prop", x)`, which is honored on upgrade.

**Wrong attribute name.** Attributes are kebab-case (`targetRef` → `target-ref`). Booleans are presence attributes (`is-paused`, not `is-paused="false"`).

## A form control shows a stale value

`value:` / `checked:` on `<input>`, `selected:` on `<option>` and `content:` on `<textarea>` also set the live property, so a control the user edited follows the rule whenever the rule writes. If it still looks stale:

- The rule did not re-run. Nothing re-runs on typing; check the state attribute the rule is gated on.
- It is a custom element. Quark writes only the attribute there; the element owns its own reflection.
- It is a `<select>`. There is no `value` attribute; write `selected:` on the matching `<option>`.

## `prop("provision")` returns nothing

- The provider hasn't assigned the `.provision` DOM node property yet.
- The selector doesn't match the provider's current state. `provider-fetch[is-success] { $foo: prop("provision") }` isn't matched while loading — that's a feature, not a bug.
- The provision isn't a plain object or array. Providers must publish POJOs.
- `prop()` reads the matched element only. To read an ancestor provider, publish it as a `$binding` from a rule matching the provider in a parent / `is-global` sheet.

## `prop("x")` never re-runs

- The object was mutated in place. Assign a new object — Quark observes assignments to `element.x`, not mutations inside it.
- The browser changed the property without a JS assignment (an `<input>`'s `value`, `open` on `<details>`). Select on the reflected attribute / listen for the event.
- The name isn't a literal. `prop($name)` reads but does not subscribe.

## A remote template never renders

- Wrong path in `template-ref`, or the fragment has more than one root element.
- The `include-content` never became active: `lazy-load` waits for viewport entry, `pre-fetch` only warms, and conditional includes need `is-active`.
- Check `is-error` on the element and the console for the fetch failure.

## Debugging tools

- **The inspector is the debugger.** Application state *is* the DOM. Watch attributes change in the Elements panel; that is your state timeline.
- **Nucleus DevTools** First-party devtools that will upgrade your Chromium dev tools to assist in inspectablility of both Neutron elements and Quark rules.
- **Coding agents** The extension's probe exposes selector-addressed JSON tools (`diagnostics`, `state_snapshot`, `explain_attribute`, …) that chrome-devtools-mcp discovers as a "Nucleus Stack" tool group, or any browser automation calls as `__NUCLEUS_DEVTOOLS__.tools.*`; the pane's **Copy for AI** button copies a one-file bug report. Works on production sites with no app changes. See [Debugging with Agents](/nucleus/docs/debugging_with_agents).
- **Custom debugging** `Neutron.attachDevtools()` is available.
- **`QuarkRegistry`** is exposed on `window` in development. `QuarkRegistry.findRules("bind-title")` returns the rules that touch a selector; each rule tracks `numberOfRuns`.
- **`is-error` attributes** on sheets, providers, forms, and includes reflect failures, and matching `*-error` events carry the detail.
- **Serialize the state.** `document.documentElement.outerHTML` is a complete, shareable snapshot of the app at the moment of a bug. It will not include data provisions or Quark `$variables`.
