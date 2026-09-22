# CSS variables

Every color, size and spacing is a `--v-*` custom property; override them on `:root` or on any subtree.

## Overriding tokens

<include-content data-demo="css-variables"></include-content>

```css
:root {
  --v-primary: #7c3aed;
  --v-primary-background: #7c3aed;
  --v-border-radius: 2rem;
}
```

Scheme-dependent tokens (colors) are declared per scheme, so override them under both `[data-scheme="light"]` / `:root:not([data-scheme="dark"])` and `[data-scheme="dark"]` (plus the `prefers-color-scheme: dark` auto case) when the value should differ — see [Color schemes](./SCHEMES.md).

## Token families

| Family | Examples |
| --- | --- |
| Typography | `--v-font-family`, `--v-font-size`, `--v-line-height`, `--v-font-weight`, `--v-h1-color` … `--v-h6-color` |
| Spacing | `--v-spacing`, `--v-typography-spacing-vertical`, `--v-block-spacing-vertical` / `-horizontal`, `--v-grid-column-gap` / `-row-gap` |
| Borders & outline | `--v-border-radius`, `--v-border-width`, `--v-outline-width`, `--v-box-shadow` |
| Colors | `--v-background-color`, `--v-color`, `--v-muted-color`, `--v-muted-border-color`, `--v-primary*`, `--v-secondary*`, `--v-contrast*` (each with `-background`, `-border`, `-hover`, `-focus`, `-inverse`, `-underline`) |
| Forms | `--v-form-element-*` (background, border, color, placeholder, active, focus, valid / invalid, disabled opacity), `--v-switch-*`, `--v-range-*`, `--v-icon-*` |
| Components | `--v-card-*`, `--v-accordion-*`, `--v-dropdown-*`, `--v-modal-overlay-*`, `--v-popover-*`, `--v-progress-*`, `--v-tooltip-*`, `--v-nav-*`, `--v-table-*`, `--v-code-*` |
| Motion | `--v-transition`, `--v-transition-duration-fast` / `-standard` / `-slow`, `--v-transition-ease-out` / `-in` / `-in-out` |

The complete list with defaults is the *CSS properties* table of the [API Reference](./README.md#md-api-reference).

## Element-level tokens

Elements redefine tokens locally rather than setting properties: a button sets `--v-background-color` and `--v-color`, headings set `--v-font-size`, `--v-line-height` and `--v-typography-spacing-top`. Override those on the element to restyle one kind of element without touching the rule:

```css
h1 { --v-font-size: 2.5rem; }
button.cta { --v-background-color: var(--v-contrast-background); }
```

## Writing tokens from Quark

`--name:` declarations write custom properties on matched elements, so State can drive theming (`:scope { --v-primary: $brand; }`) — see the quark docs *CSS variables*.
