# No reversion

Quark rules do not undo their writes when they stop matching — the one deliberate divergence from CSS.

## Write the inverse rule

In CSS, a rule's declarations stop applying the moment its selector stops matching. **Quark rules do not revert** — this applies to every property kind: attributes, content, listeners, `$variables`, and CSS variables persist after the rule that set them stops matching. Write the counter-rule for every state you leave:

```quark
details[open] { --border-color: "red"; }
details:not([open]) { --border-color: "transparent"; }
```

The same applies to `:has()` facts (`:scope:has(…)` + `:scope:not(:has(…))`, see [Selectors](./SELECTORS.md)) and to any attribute derived from a condition.

## Why

Quark does not own the document: anything can write an attribute outside a sheet's knowledge, so pretending a rule can be applied and unapplied like CSS would be dishonest. Unmatch reversion may be introduced in a future version.
