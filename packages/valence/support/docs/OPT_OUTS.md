# Opt-outs

Valence.css is opinionated; these classes hand an element — or a subtree — back to the browser.

## Unstyled

`.unstyled` reverts every Valence.css rule on one element; `.unstyled-all` does it for the element and all its descendants (`all: revert !important`).

<include-content data-demo="opt-outs"></include-content>

Use them where a third-party widget or a custom element brings its own styling and Valence.css would fight it.

## Unanimated

`.unanimated` / `.unanimated-all` kill transitions and animations (the same rules `prefers-reduced-motion: reduce` applies everywhere, except on `[aria-busy="true"]` spinners).

## Abstract wrappers

`.abstract` sets `display: contents`, so a wrapper — typically a custom element — is invisible to layout *and* to the Valence.css direct-child rules: `article > .abstract > header` is still styled as a card header. Rules that expect direct children (`article > header`, `details > summary`, `dialog > article`, `label > input`) look through one or two `.abstract` levels.

```html
<article>
  <event-handler class="abstract">
    <header>Still a card header</header>
  </event-handler>
</article>
```

## Layers

Element and alias styles sit in an anonymous `@layer`, so a consumer stylesheet or a custom element's own CSS overrides them at any specificity. The class utilities (`.grid`, `.container`, `.abstract`, the opt-outs) stay unlayered so they still win — see [Themes & layers](./THEMES.md).
