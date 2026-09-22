# Valence.css

Classless CSS that still loves your custom elements — Pico's elegance, remixed for the modern web.

Valence.css is a lightly modified fork of the excellent [Pico CSS](https://picocss.com). Pico styles are tightly bound to native tag names (`article`, `button`, …), which custom elements cannot reuse. Valence.css keeps Pico's look and adds:

- **Tag aliases** — `@custom-selector` synonyms so `[role="…"]` / `.tag-*` (and custom element tags) share the same semantic styles
- **Opt-outs** — `.unstyled` / `.unstyled-all` (and `.unanimated*`) for document flexibility where framework styles would fight you
- **Drop-in themes** — `basic` (Pico-faithful) ships today; further themes share the same tokens so they can be swapped without touching markup. Light/dark is a *scheme* (`[data-scheme]`)
- **Molecules** — cards, dropdowns, modals (`dialog::backdrop` / `[role="presentation"]` / `.tag-backdrop`), nav, progress, and native `[popover]` styles on top of Pico's element styles
- **Tokens** — `--pico-*` renamed to `--v-*` for a clear Valence.css namespace

## Features

- **Semantic tag aliases** Style `article`, `dialog`, `button`, … — the same rules apply to the `[role="…"]` / `.tag-*` forms
- **Custom-element friendly** `class="tag-article"` on any host inherits Valence.css styles without rewriting selectors
- **Drop-in themes** `basic` (Pico-flavor) ships; further themes share the same tokens. Scheme via `[data-scheme="light|dark"]`
- **Opt-outs** `.unstyled` / `.unstyled-all` (and motion: `.unanimated*`)
- **Molecules** Cards, dropdowns, modals (`dialog::backdrop` / `[role="presentation"]` / `.tag-backdrop`), nav, progress, popovers, tooltips

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Import a theme entry (CSS). Prefer aliases when styling custom elements.

```css
@import "@excom/valence/basic.css";
```

```html
<article>Native card</article>
<event-handler class="tag-article">Aliased card</event-handler>
<button class="outline secondary">Outline</button>
```

### Documentation

Getting started

- [Color schemes](./SCHEMES.md) — automatic light / dark, `data-scheme`
- [Aliases](./ALIASES.md) — tag, role and `.tag-*` forms of every alias; custom elements
- [Opt-outs](./OPT_OUTS.md) — `.unstyled`, `.unanimated`, `.abstract`

Customization

- [CSS variables](./CSS_VARIABLES.md) — the `--v-*` tokens
- [Themes & layers](./THEMES.md) — entries, `@layer` strategy, mixins for element authors

Layout

- [Container](./CONTAINER.md) · [Landmarks & section](./LANDMARKS.md) · [Grid](./GRID.md) · [Overflow auto](./OVERFLOW_AUTO.md)

Content

- [Typography](./TYPOGRAPHY.md) · [Link](./LINK.md) · [Button](./BUTTON.md) · [Table](./TABLE.md) · [Code](./CODE.md) · [Embedded content](./EMBEDDED.md)

Forms

- [Forms](./FORMS.md) · [Input](./INPUT.md) · [Textarea](./TEXTAREA.md) · [Select](./SELECT.md) · [Checkboxes, radios & switches](./CHECKBOXES.md) · [Range](./RANGE.md)

Components

- [Accordion](./ACCORDION.md) · [Card](./CARD.md) · [Dropdown](./DROPDOWN.md) · [Group](./GROUP.md) · [Loading](./LOADING.md) · [Modal](./MODAL.md) · [Nav](./NAV.md) · [Popover](./POPOVER.md) · [Progress](./PROGRESS.md) · [Tooltip](./TOOLTIP.md)

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>
