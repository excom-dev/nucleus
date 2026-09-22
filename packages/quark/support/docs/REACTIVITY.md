# Reactivity

A rule runs when an element matches it and re-runs when something its selector or its values depend on changes — nothing more, nothing less.

## When a rule re-runs

- an attribute, class (`.x`) or id (`#x`) named in its selector changing on the matched element, on an ancestor or earlier sibling on the selector's path, or on a descendant named in `:has()` (a class change counts only when it adds or removes a class the sheet names, unless a rule needs the whole value: `[class~="x"]`, `attr("class")`);
- a literal `attr("x")` in one of its values, when `x` changes on the matched element;
- a `$binding` one of its values reads, when that binding changes on an ancestor-or-self owner (the nearest owner wins, so a farther change is ignored);
- a literal `prop("x")` in one of its values, when JS assigns `element.x`;
- elements being inserted anywhere under the host, whether by Quark, an element, or app JS (a `childList` MutationObserver): rules matching the new elements run, `content` rules below the insertion point re-run, and `:has()` / `:empty` candidates above it are re-checked;
- elements being removed, only while some rule's match depends on children or sibling position (`:has()`, `:empty`, `:nth-child()`, `a + b`): the same re-runs as an insertion at that parent. Text-only changes are never observed.

## Not observed

Interaction and validity pseudo-classes (`:hover`, `:focus`, `:checked`, `:invalid`, … — warned at build), pseudo-elements, `attr($dynamic)` / `prop($dynamic)`, `closest()` and DOM method reads (`getAttribute`, `matches`), in-place mutation of an object a `prop()` or `$binding` holds, and browser-driven native state that does not go through a JS setter (typing into an `<input>`, `<details>` toggling). Select on reflected attributes or listen to events for those. The reverse direction is covered: `value` / `checked` / `selected` / textarea `content` writes also set the live property on native form controls (see [Attributes](./ATTRIBUTES.md)).

## Loops

A declaration is never re-run by the attribute it wrote (the mutation that woke the rule is excluded from that pass), so a rule cannot loop on its own gate. `class:` is the exception: classes are separate facts, so `.is-done { class: (is-struck: true); }` applies when `is-done` arrives. Setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance. Cycles through two or more attributes or classes, `$bindings` across sheets, content that re-matches its own paint, element effects or events are cut by the shared [loop guard](./LOOP_GUARD.md): every write carries the depth of the chain that caused it — a deferred paint keeps the depth of the run that scheduled it; an observer record, an `attributeChangedCallback` or a property-change event inherits the depth stamped on the address it reacts to — and the hop past `LoopGuard.limit` (50) is dropped, logged once and published as `quark/error`. Chains restart at zero on every external write in a later task, so a stream of provider updates never trips. Rules that gate on attributes they write for each other are warned about when the sheet builds (`Quark: rules gate on attributes they write for each other — …`).

## Timing

Listeners and `$variables` apply synchronously; attributes, CSS variables and content are painted in a batch one task later, and the rules that depend on those writes run in the next cycle. Writes more than a tick apart are separate facts.
