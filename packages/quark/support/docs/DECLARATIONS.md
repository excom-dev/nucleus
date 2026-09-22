# Declaration kinds

The property key selects what a declaration does: a `$variable`, a CSS variable, `content`, one of the attribute helpers, or an attribute of that name.

## By key shape

Checked top to bottom; the first match wins. Listeners are at-rules, not declarations. *Generated.*

<!-- generated:declaration-kinds -->
| Key | Effect | Accepts |
| --- | --- | --- |
| `$name` | Stores a binding on each matched element; consumers resolve it by walking up from their own element (CSS custom-property semantics, shared across sheets). | Any value. `unset` deletes the binding. |
| `--name` | Writes the CSS custom property `--name` on the element's inline style. Write-only: Quark never reads CSS variables back. A trailing `!important` inside the string sets the priority. | A string or number. CSS literals must be quoted (`"#ccc"`, `"10px"`); bare `#hex` / unit numbers are rejected at build. |
| `content` | Replaces the element's rendered children (a source `<template>` child is kept). Promises are awaited. Writing into a `<template>` targets its `.content`. On a `<textarea>` a text result is also mirrored to the live `.value` (the text is only the default value). | A string (text), a `Node` / `NodeList`, or the result of `template()` / `iterate()` / `dangerous-html()`. Wipe values clear. |
| `class` | Sets the `class` attribute. | A string (replaces), an array (joined with spaces), or an object (`{ name: boolean }` toggles each class). Wipe values remove the attribute. |
| `dataset` | Writes one `data-*` attribute per key (camelCase → dash-case) and removes `data-*` attributes this sheet set earlier. | An object. Strings / numbers write as-is, booleans as present / absent, string arrays space-joined, objects and other arrays as their length. |
| `ariaset` | Same as `dataset`, with the `aria-` prefix. | An object (same conversions as `dataset`). |
| `<anything else>` | Sets the attribute of that name on the matched element (`none` removes it). Always contains a dash in practice; `autofocus: ""` sets a boolean attribute. On native form controls the attribute is authoritative: `value` / `checked` on `<input>` and `selected` on `<option>` also set the live property, so a control the user has edited still follows the rule. | A string or number (written as text), a boolean (`true` → `""`, `false` → removed), or a wipe value. |
<!-- /generated -->

## Details per kind

- [Attributes](./ATTRIBUTES.md) — the default kind, `class` / `dataset` / `ariaset`, form controls
- [Content](./CONTENT.md) — `content` with `template()`, `iterate()`, `dangerous-html()`
- [CSS variables](./CSS_VARIABLES.md) — `--name`
- [Variables](./VARIABLES.md) — `$name`
