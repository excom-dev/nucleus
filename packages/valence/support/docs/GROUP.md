# Group

`[role="group"]` joins an input and a button (or several controls) into one pill; `[role="search"]` is the rounded variant.

## Usage

<include-content data-demo="group"></include-content>

```html
<fieldset role="group">
  <input type="email" placeholder="Email" />
  <button type="submit">Subscribe</button>
</fieldset>
<fieldset role="search">
  <input type="search" placeholder="Search" />
  <button type="submit">Go</button>
</fieldset>
```

- Children lose their inner radii and margins; buttons shrink to their content and get wider padding.
- Focus moves to the group: `--v-group-box-shadow-focus-with-input` when an input is focused, `--v-group-box-shadow-focus-with-button` (per button flavor) when a button is.
- A `label` holding a `role="switch"` checkbox becomes an attached segment.

Aliases: `.tag-group`, `.tag-search`.
