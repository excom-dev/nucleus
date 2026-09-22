# Limitations:
- Interaction / validity pseudo-classes (`:hover`, `:focus`, `:checked`, `:invalid`, …) and pseudo-elements are not observed — the rule matches on its first run only (warned at build; see README *Selectors*)
- `:has(+ …)` / `:has(~ …)` and a `:has()` nested in a complex `:is()` / `:not()` argument re-run the whole rule from the host
- `:empty` ignores text-only changes; `:nth-child(… of S)` observes only the attributes in `S`; `:open` covers `<details>` / `<dialog>` only
- At-rules other than `@use` / `@scope` / `@on` / `@view-transition` / `@delay` / `@warn` (`@debug`, `@error`) are not supported yet
- `@view-transition` relies on `document.startViewTransition()`: one transition per document, no scoped transitions yet; `until` freezes the page while it waits (short waits only)
- Setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance (a sheet that names any class wakes on every class change under its host)
- Runaway cycles (attribute ↔ attribute, `$binding` ↔ `$binding` across sheets, content re-matching its own paint, rule ↔ element effect, attribute ↔ event) are cut by the shared loop guard after `LoopGuard.limit` (50) dependent writes, not prevented; writers Quark / Neutron do not route (plain `setAttribute` in app JS) are invisible to it
