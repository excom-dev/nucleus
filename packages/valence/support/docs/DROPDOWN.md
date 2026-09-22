# Dropdown

A `details.dropdown` opens a menu below its `summary`: select-styled by default, button-styled with `role="button"`, and inline inside a [nav](./NAV.md).

## Usage

<include-content data-demo="dropdown"></include-content>

```html
<details class="dropdown">
  <summary>Choose…</summary>
  <ul>
    <li><a href="#">Option</a></li>
    <li><label><input type="checkbox" /> Toggle</label></li>
  </ul>
</details>
```

- The default `summary` looks like a `select` (chevron, `--v-form-element-*` tokens, `aria-invalid` colors); `summary[role="button"]` looks like a [button](./BUTTON.md).
- The menu is the `ul` right after the summary: absolutely positioned, `--v-dropdown-*` tokens, links and labels fill each row; `dir="rtl"` on the list right-aligns it.
- While open, an invisible full-page `::before` on the summary closes the menu on an outside click — no JS.
- Inside a `nav`, the dropdown sits inline with the links; inside a `label`, it aligns like a control.
