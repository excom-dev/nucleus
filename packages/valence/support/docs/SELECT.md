# Select

A `select` gets the input look plus a chevron; `multiple` / `size` lists drop the chevron and highlight selected options.

## Usage

<include-content data-demo="select"></include-content>

```html
<select name="planet" required>
  <option selected disabled value="">Select a planet…</option>
  <option>Earth</option>
</select>
```

A `required` select whose selected option has an empty value renders in the placeholder color (`select:invalid`). Selected options in a `[multiple]` list use `--v-form-element-selected-background-color`.

`select` has no alias; for a custom picker style a [dropdown](./DROPDOWN.md).
