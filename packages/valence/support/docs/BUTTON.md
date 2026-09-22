# Button

Buttons come in primary, `.secondary` and `.contrast`, each with an `.outline` variant, and the same styles apply to any `[role="button"]` or `.tag-button` element.

## Flavors

<include-content data-demo="button"></include-content>

```html
<button>Primary</button>
<button class="secondary">Secondary</button>
<button class="contrast">Contrast</button>
<button class="outline">Outline</button>
<button class="outline secondary">Outline secondary</button>
```

`[type="submit"]` is primary, `[type="reset"]` secondary and `[type="file"]`'s selector button secondary. Buttons are `inline-block`; a `[type="submit"]` inside a form is full-width (see [Forms](./FORMS.md)).

## States

- **Disabled** — `[disabled]` or `aria-disabled="true"` (`:--button--disabled`): half opacity, no pointer events; a `fieldset[disabled]` disables every button inside.
- **Busy** — `aria-busy="true"` shows the [loading](./LOADING.md) spinner and blocks pointer events.
- **Current** — `[aria-current]` (not `"false"`) renders the hover state.
- **Focus** — a `--v-primary-focus` ring (`-secondary-` / `-contrast-` per flavor).

## Tokens

A button reads `--v-background-color`, `--v-border-color`, `--v-color` and `--v-box-shadow` from its flavor (`--v-primary-background`, `--v-primary-border`, `--v-primary-inverse`, …); override those on the element or restyle a flavor globally through the [CSS variables](./CSS_VARIABLES.md).
