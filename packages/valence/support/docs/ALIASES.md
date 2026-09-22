# Aliases

Every Valence.css tag alias is a `@custom-selector` that matches the native tag, its ARIA role and an `.tag-*` class — so a custom element or a plain `div` can wear any semantic style.

## Three ways to match

`:--article` expands to `article, [role="article"], .tag-article`. Pico ties its styles to tag names, which custom elements cannot reuse; Valence.css adds the role and class forms to every tag alias:

<include-content data-demo="aliases"></include-content>

| Alias | Matches |
| --- | --- |
| `:--article` | `article`, `[role="article"]`, `.tag-article` |
| `:--button` | `button`, `[role="button"]`, `[type="button"]`, `.tag-button` |
| `:--details` / `:--summary` | `details` / `summary`, `.tag-details` / `.tag-summary` |
| `:--dialog` | `dialog`, `[role="dialog"]`, `.tag-dialog` |
| `:--nav`, `:--list`, `:--li` | `nav` / `[role="navigation"]`, `ul` / `ol` / `[role="list"]`, `li` / `[role="listitem"]` |
| `:--table`, `:--tr`, `:--th`, `:--td` | tags, `[role="table"]` / `"row"` / `"columnheader"` / `"cell"`, `[scope]` |
| `:--heading`, `:--h1` … `:--h6` | `h1`…`h6`, `[role="heading"][aria-level]` |

The full list is in the *API Reference* on the [package page](./README.md#md-api-reference) (*CSS aliases*). Prefer the role form when the element genuinely has that role (screen readers benefit too); use `.tag-*` when it does not.

## State aliases

States are `:--{element}--{state}` and match ARIA as well as native state: `:--details--open` is `[open], [aria-expanded="true"]`; `:--button--disabled` is `[disabled], [aria-disabled="true"]`; `:--progress--value` is `[value], [aria-valuenow]`. A custom element that reflects `aria-expanded` gets the open styling for free.

## Custom elements

- Put the tag alias class on the host (`<content-drawer class="tag-article">`) — styles apply without the element knowing Valence.css exists.
- Elements with a shadow root inherit the tokens through `:host`; only the tokens cross the boundary, the rules do not.
- `.abstract` (`display: contents`) lets a wrapper element sit between a parent and the children a rule expects (`article > header`): see [Opt-outs](./OPT_OUTS.md).

## Not aliased

Inimitable natives — `input`, `textarea`, `select` — have no alias; style a wrapper or use the native control. Pseudo-elements cannot be aliased (`postcss-custom-selectors` wraps in `:is()`), which is why the modal backdrop is a sibling element for custom hosts (see [Modal](./MODAL.md)).
