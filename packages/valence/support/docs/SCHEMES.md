# Color schemes

Light and dark are a *scheme*: automatic from the OS, or forced on any subtree with `data-scheme`.

## Automatic

With no attribute, the document follows `prefers-color-scheme`. Every token that differs between the two schemes (`--v-background-color`, `--v-color`, `--v-primary`, the form and card colors, …) is defined once per scheme, so the whole page — and every custom element using the tokens — flips together.

## Forcing a scheme

`data-scheme="light"` or `data-scheme="dark"` on `<html>` forces the document; on any other element it forces that subtree. The attribute also sets `color-scheme`, so native controls and scrollbars follow.

<include-content data-demo="schemes"></include-content>

```html
<html data-scheme="dark">…</html>
<article data-scheme="light">Always light</article>
```

Switching at runtime is one attribute write — a Quark rule (`html { data-scheme: $theme; }`) or `<provider-storage>` can own it. Custom elements with a shadow root get the same tokens through `:host`.
