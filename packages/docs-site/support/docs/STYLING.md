# Styling

Style the state, not the script. CSS in the Nucleus Stack can read the same attributes Quark does, so visuals and behavior stay aligned without a line of glue.

## Valence.css

**Valence.css** is the stack's semantic, classless CSS: Pico's elegance, remixed so custom elements receive the same treatment as native tags, with other minor additions.

```css
@import "@excom/valence/basic.css";
```

`nucleus-kit/basic.css` already includes Valence.css plus every element's own styles, so loading Nucleus Kit means you are already styled.

- **Semantic tag aliases** — `article`, `button`, `dialog`, `table`, forms, and typography look right with no classes at all.
- **Role and class forms** — every tag alias is also matched by an ARIA role and a `.tag-*` class, so a custom element can borrow a native look: `<event-handler role="button">` or `<my-card class="tag-article">`. Prefer the role; semantics come along for free.
- **Molecules** — cards, dropdowns, modals, nav, progress, popovers, and tooltips assembled on top of the tag aliases.
- **Schemes** — light by default, dark via `prefers-color-scheme`, or force either with `<html data-scheme="dark">`.
- **Themes** — `basic` stays Pico-faithful; further themes share the same tokens so they can be swapped without touching markup.
- **Opt-outs** — `.unstyled` strips Valence.css from an element, `.unstyled-all` from its subtree, `.unanimated*` drops motion. Reach for these wherever framework styles would fight you.

## Tokens

Design tokens are CSS custom properties under the `--v-*` namespace: `--v-primary`, `--v-spacing`, `--v-border-radius`, `--v-font-family`, and the rest. Override them at `:root`, on a scheme, or on any subtree.

```css
:root { --v-primary: #2a6; --v-border-radius: 0.75rem; }
[data-scheme="dark"] { --v-primary: #5c8; }
aside { --v-spacing: 0.5rem; }
```

Use tokens in your own CSS so themes and schemes apply to your views automatically.

## Style the state

**Classes are for static flavor only.** `details.accordion` versus `details.dropdown` is a class. `.is-open` is not — that is state, and state belongs in an attribute the whole stack can see.

Hook native state first, then ARIA, then `data-*`:

```css
details[open] > summary { font-weight: 600; }
input:not(:valid) { border-color: crimson; }
[aria-current] { text-decoration: underline; }
li[data-done] { opacity: 0.6; text-decoration: line-through; }
```

Element state attributes are the same hooks:

```css
provider-fetch[is-loading] { opacity: 0.5; pointer-events: none; }
provider-fetch[is-error]::before { content: "Something went wrong."; }
spa-a[is-active] { color: var(--v-primary); }
```

The payoff: one attribute drives CSS, Quark, and assistive technology together, and it is visible in the inspector.

## Element CSS

Every element ships its styles next to its script and documents its CSS hooks on its package page: exposed variables, style classes (`content-tabs.underline`, `content-tabs.file-tabs`), and aliases. Override with your own selectors; nothing is locked behind a shadow root.

Write modern CSS in your stylesheets. Nesting, `@scope`, `:has()`, `color-mix()`, container queries, and view transitions are all fair game there; a Quark sheet is a different language and takes only Quark's own at-rules. Quark observes `:has()` too; interaction pseudo-classes (`:hover`, `:focus`) stay CSS-only (first run in a sheet).

## Quark and CSS together

Quark can write CSS custom properties from state, and CSS consumes them with `var()`. Use this for values a selector cannot express: computed colors, percentages, live theming.

```quark
[bind-progress] { --progress: "#{($done / $total * 100)}%"; }
```

```css
[bind-progress]::after { width: var(--progress); }
```

Quote CSS literals in Quark (`"#ccc"`, `"10px"`) — the value is an expression, not CSS grammar.

## Animation

State describes only the present, so an animation — a description of change over time — has no place in the document. Declare the destination state and let CSS own the motion:

- **Transitions** on state attributes: `[data-open] { translate: 0; transition: translate 200ms; }`
- **View transitions** between routes: `spa-manager` batches route changes into one `document.startViewTransition()`, and `spa-route` / `spa-a` reflect `is-active` / `was-active` so you can style enter and exit. `last-move` on the manager (`push` / `back` / `forward`) picks direction-aware transitions.
- **Card expansion and shared-element effects** come from CSS `view-transition-name` keyed to those same attributes.
- **List and content changes** from Quark: wrap the writes in `@view-transition (types: "…") { … }` and style the result. `view-transition-name: match-element` plus a `view-transition-class` on rows gives each row its own group, so `::view-transition-new(.row):only-child` animates rows that enter and `::view-transition-old(.row):only-child` rows that leave, and `:root:active-view-transition-type(…)` scopes the rules to that change. Keyed `iterate()` keeps rows alive, so moved rows slide instead of fading. Where `match-element` is not available, let the sheet name the rows (`--vt-name: "row-#{item.id}"`) and read it in CSS (`view-transition-name: var(--vt-name)`). The [View Transitions](/nucleus/examples/view-transitions) example shows a card expansion, a page slide, a list reflow and a text crossfade built this way.

Quark writes are batched and not frame-aligned, so it is the wrong tool for per-frame values. Reach for CSS or the Web Animations API instead.

## Views

Each view owns its stylesheet, loaded by a `<link>` at the top of the fragment. Scope view CSS to the view's root element and keep shared layout in one site-wide stylesheet. See [Building Views](/nucleus/docs/building_views).
