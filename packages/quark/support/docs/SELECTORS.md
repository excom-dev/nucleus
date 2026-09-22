# Selectors

Quark rides the native selector engine: whatever `querySelectorAll` matches, a rule matches. What Quark adds is observation — knowing which changes can flip a match and where the subjects are afterwards.

## What is observed

Attributes, classes and ids named anywhere in a selector are observed on the element they sit on: the matched element, an ancestor or earlier sibling on the selector's path, or a descendant named in `:has()`. Structure is observed too: elements inserted or removed under the host re-check the rules whose match depends on children or sibling position. *Generated.*

<!-- generated:selectors -->
**Combinators**

| Combinator | Observed |
| --- | --- |
| `a b` | Descendant. An attribute change on `a` re-runs the rule for the matching `b`s below it. |
| `a > b` | Child. Same observation as the descendant combinator. |
| `a + b` | Next sibling. An attribute change on `a` re-runs the rule from the parent; elements inserted or removed under that parent re-run it too. |
| `a ~ b` | Subsequent siblings. Same observation as `+`. |

**Logical**

| Pseudo-class | Observed |
| --- | --- |
| `:is(…)` | Attributes anywhere in the argument list are observed like the compound's own. A complex argument (`:is(section[x] li)`) re-runs the rule from the changed element down. |
| `:where(…)` | Same as `:is()` (Quark has no specificity). |
| `:not(…)` | Same observation as `:is()`. |

**Relational**

| Pseudo-class | Observed |
| --- | --- |
| `:has(…)` | Attributes named in the argument are observed on descendants, and elements inserted or removed below a candidate re-check it: the rule re-runs for every matching ancestor of the change. Sibling-relative arguments (`:has(+ …)`, `:has(~ …)`) and a `:has()` nested in a complex `:is()` / `:not()` argument re-run the whole rule from the host instead. Without rule reversion, pair it with the inverse `:not(:has(…))` rule. |

**Structural (sibling position, children)**

| Pseudo-class | Observed |
| --- | --- |
| `:first-child` | Sibling position: re-runs when elements are inserted or removed under the parent. |
| `:last-child` | Same as `:first-child`. |
| `:only-child` | Same as `:first-child`. |
| `:nth-child(An+B [of S])` | Same as `:first-child`. With `of S`, attributes in `S` are observed on the siblings and each change re-runs the rule from the parent. |
| `:nth-last-child(An+B [of S])` | Same as `:nth-child()`. |
| `:first-of-type` | Same as `:first-child`. |
| `:last-of-type` | Same as `:first-child`. |
| `:only-of-type` | Same as `:first-child`. |
| `:nth-of-type(An+B)` | Same as `:first-child`. |
| `:nth-last-of-type(An+B)` | Same as `:first-child`. |
| `:empty` | Re-checked when elements are inserted or removed below the element. Text-only changes are not observed. |

**Attribute-backed**

| Pseudo-class | Observed |
| --- | --- |
| `:disabled` | Observes `disabled` on the element and on ancestors (a disabled `<fieldset>`). |
| `:enabled` | Same as `:disabled`. |
| `:required` | Observes `required`. |
| `:optional` | Same as `:required`. |
| `:read-only` | Observes `readonly`, `disabled` and `contenteditable` on the element and its ancestors. |
| `:read-write` | Same as `:read-only`. |
| `:any-link` | Observes `href`. |
| `:lang(…)` | Observes `lang` on the element and its ancestors. |
| `:open` | Observes the `open` attribute (`<details>`, `<dialog>`). A `<select>` / `<input>` picker opening is not observed. |

**Static**

| Pseudo-class | Observed |
| --- | --- |
| `:scope` | The host; never changes. |
| `:root` | The document element; never changes. |

**Not observed** — `:hover`, `:focus`, `:focus-within`, `:focus-visible`, `:active`, `:visited`, `:link`, `:target`, `:checked`, `:indeterminate`, `:default`, `:valid`, `:invalid`, `:in-range`, `:out-of-range`, `:placeholder-shown`, `:popover-open`, `:modal`, `:fullscreen`, `:defined`, `:dir(…)`: Interaction or browser state with no attribute behind it: matches on the first run only (warned at build). Select on reflected attributes instead. Any pseudo-class not listed above is treated the same way.
<!-- /generated -->

## `:has()`

`:has()` costs a native subtree scan per candidate on every fan-out that includes the rule, plus one ancestor walk per observed change — keep its arguments shallow and off rules that match many rows. Without rule reversion a `:has()` rule needs its inverse (`:not(:has(…))`) like any other state:

```quark
/* an aggregate over the rows becomes a fact on the host */
:scope:has(li[data-is-selected]) { data-has-selection: ""; }
:scope:not(:has(li[data-is-selected])) { data-has-selection: none; }
```

## Classes and ids

Class (`.x`) and id (`#x`) selectors are observed like attributes (a class change counts only when it adds or removes a class the sheet names). Setting attributes is still recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance: a sheet that names any class wakes on every class change under its host (styling churn included).

When a rule re-runs, and what stays unobserved: [Reactivity](./REACTIVITY.md).
