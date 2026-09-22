# Nav

A `nav` lays its lists out horizontally — one left, one right — and becomes a breadcrumb with `aria-label="breadcrumb"`, a vertical menu inside an `aside`, or an outline tree with `role="tree"`.

## Usage

<include-content data-demo="nav"></include-content>

```html
<nav>
  <ul><li><strong>Brand</strong></li></ul>
  <ul>
    <li><a href="#">Docs</a></li>
    <li><a href="#" aria-current="page">Blog</a></li>
    <li><details class="dropdown"><summary>More</summary><ul dir="rtl">…</ul></details></li>
  </ul>
</nav>
```

- Links are padded pills (`--v-nav-link-spacing-*`) without underline until hover; buttons, inputs and selects inside a nav shrink to fit; a [dropdown](./DROPDOWN.md) sits inline.
- **Breadcrumb**: `nav[aria-label="breadcrumb"]` joins items with `--v-nav-breadcrumb-divider` (`>`) and mutes the `aria-current` link.
- **Vertical**: inside an `aside`, `nav`, its lists and items stack; links fill the row.
- **Tree**: `ul[role="tree"]` (or `.tag-tree`) draws a left rule, indents nested trees and highlights the `aria-current` link with a primary border — the docs sidebar is one.

Aliases: `[role="navigation"]` / `.tag-nav`, `[role="list"]` / `.tag-list`, `[role="listitem"]` / `.tag-li`.
