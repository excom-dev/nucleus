# Link

Links are primary-colored and underlined; `.secondary` and `.contrast` change the flavor, `aria-current` marks the active one.

## Flavors

<include-content data-demo="link"></include-content>

```html
<a href="#">Primary</a>
<a href="#" class="secondary">Secondary</a>
<a href="#" class="contrast">Contrast</a>
```

Hover, focus, active and `[aria-current]` (any value but `"false"`) switch to the `-hover` tokens; `:focus-visible` adds a `--v-primary-focus` ring. The underline color is `--v-primary-underline` (and `-secondary-` / `-contrast-`).

## Link as button

`<a role="button">` (or `.tag-button`) takes the full [button](./BUTTON.md) styling, including the flavors and `.outline`.

## Aliases

`:--link` is `a`, `[role="link"]`, `.tag-link` — a `<spa-a role="link">` custom element is styled as a link without any CSS of its own.
