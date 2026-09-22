# Limitations

What the current engine does not observe or support, and the pitfalls that follow from it.

## Beta limits

- Selector features backed by state the DOM does not reflect are not observed: interaction and validity pseudo-classes (`:hover`, `:focus`, `:checked`, `:invalid`, …) match on the first run only, and the rule logs a warning at build. Everything else the native engine matches is observed — see [Selectors](./SELECTORS.md) for the list and the partial cases (`:empty` ignores text-only changes, `:nth-child(… of S)` observes only the attributes in `S`, `:open` covers `<details>` / `<dialog>` only, sibling-relative `:has(+ …)` re-runs the whole rule)
- At-rules are Quark's own — `@use`, `@scope`, `@on`, `@dispatch` / `@command`, `@view-transition`, `@delay`, `@warn` / `@debug` / `@error` — and any other name is a parse error, so CSS's `@media` / `@keyframes` and SCSS's control flow belong in a stylesheet, not a sheet
- Setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance: a sheet that names any class wakes on every class change under its host (styling churn included)
- Rules do not revert when they stop matching — see [No reversion](./NO_REVERSION.md)
- `@view-transition` relies on `document.startViewTransition()`: one transition per document, no scoped transitions yet; `until` freezes the page while it waits (short waits only)

See the related section under [Limitations](/nucleus/docs/limitations) in the guides.

## Pitfalls

Do not render a template that re-matches the same rule — the loop guard cuts it after 50 nested paints, but the fix is the selector:

```quark
/* BAD — each new span matches again */
span {
  content: template("#span-template");
}
```

A sheet that registers after an element's connect-time events will not hear them (no replay): react to state attributes, or load the sheet first in its host.
