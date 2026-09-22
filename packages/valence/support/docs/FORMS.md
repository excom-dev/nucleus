# Forms

Form controls are full-width, labels stack above them, and validity, helper text and disabled states come from attributes alone.

## Overview

<include-content data-demo="forms"></include-content>

```html
<form>
  <label>
    Email
    <input type="email" name="email" />
    <small>We never share it.</small>
  </label>
  <fieldset>
    <legend>Plan</legend>
    <label><input type="radio" name="plan" checked /> Free</label>
  </fieldset>
  <button type="submit">Sign up</button>
</form>
```

## Layout

- `input` (except checkbox / radio), `select`, `textarea` and `button[type="submit"]` are `width: 100%` with `--v-spacing` below.
- A `label` is a block with the control inside it or before it; `fieldset` / `legend` group controls without borders.
- Put controls in a [`.grid`](./GRID.md) for columns, or in a [group](./GROUP.md) for an input + button pair.

## Helper text

A `small` right after an `input`, `select`, `textarea`, `fieldset` or `.grid` becomes a muted note; it turns green / red after a control with `aria-invalid="false"` / `"true"`.

## Validation

`aria-invalid="true"` / `"false"` colors the border and focus ring and draws an icon inside text-like inputs (`--v-icon-invalid` / `--v-icon-valid`). No class is needed and the state stays in the document, where CSS, Quark and assistive technology all read it.

## Disabled

`[disabled]` controls (and every control inside a `fieldset[disabled]`) drop to `--v-form-element-disabled-opacity` and ignore the pointer; a `label[aria-disabled="true"]` mutes its text too.

## Controls

[Input](./INPUT.md) · [Textarea](./TEXTAREA.md) · [Select](./SELECT.md) · [Checkboxes, radios & switches](./CHECKBOXES.md) · [Range](./RANGE.md)
