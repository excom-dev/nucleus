# Accordion

`details` / `summary` is the accordion: a chevron marker, animated content, and a `summary[role="button"]` variant.

## Usage

<include-content data-demo="accordion"></include-content>

```html
<details>
  <summary>Title</summary>
  <p>Content</p>
</details>
<details>
  <summary role="button" class="outline secondary">Button summary</summary>
  <p>Content</p>
</details>
```

- The content (`::details-content`) animates height and opacity on open / close (`interpolate-size`; instant under reduced motion).
- `summary[role="button"]` is a full-width button and takes every [button](./BUTTON.md) flavor.
- Open state is `:--details--open`: `[open]` or `aria-expanded="true"`, so a custom disclosure element reflecting ARIA gets the rotated marker and colors.

## Aliases

`.tag-details` / `.tag-summary` (`details` has no ARIA role; `summary`'s implicit role is `button`, deliberately not aliased to avoid colliding with `:--button`). A [dropdown](./DROPDOWN.md) is an accordion with `.dropdown`.
