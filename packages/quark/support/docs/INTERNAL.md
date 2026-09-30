# Limitations:
- Interaction / validity pseudo-classes (`:hover`, `:focus`, `:checked`, `:invalid`, …) and pseudo-elements are not observed — the rule matches on its first run only (warned at build; see [Selectors](./SELECTORS.md))
- `:has(+ …)` / `:has(~ …)` and a `:has()` nested in a complex `:is()` / `:not()` argument re-run the whole rule from the host
- `:empty` ignores text-only changes; `:nth-child(… of S)` observes only the attributes in `S`; `:open` covers `<details>` / `<dialog>` only
- At-rules are the set on [At-rules](./AT_RULES.md) (`@use`, `@scope`, `@on`, `@dispatch` / `@command`, `@view-transition`, `@delay`, `@warn` / `@debug` / `@error`); any other is a parse error by design, so the sheet fails to load
- `@view-transition` relies on `document.startViewTransition()`: one transition per document, no scoped transitions yet; `until` freezes the page while it waits (short waits only)
- Setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance (a sheet that names any class wakes on every class change under its host)
- Runaway cycles (attribute ↔ attribute, `$binding` ↔ `$binding` across sheets, content re-matching its own paint, rule ↔ element effect, attribute ↔ event) are cut by the shared loop guard after `LoopGuard.limit` (50) dependent writes, not prevented; writers Quark / Neutron do not route (plain `setAttribute` in app JS) are invisible to it
