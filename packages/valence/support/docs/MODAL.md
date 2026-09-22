# Modal

A native `dialog` centers an `article` over a dimmed backdrop; the header's close control and the footer buttons are styled, and `[role="dialog"]` hosts get the same look with a sibling backdrop.

## Usage

<include-content data-demo="modal"></include-content>

```html
<dialog>
  <article>
    <header>
      <button rel="prev" aria-label="Close"></button>
      <h5>Confirm</h5>
    </header>
    <p>…</p>
    <footer>
      <form method="dialog">
        <button class="secondary">Cancel</button>
        <button>Confirm</button>
      </form>
    </footer>
  </article>
</dialog>
```

- Open it with `dialog.showModal()`, `<dialog-anchor>`, or an `<event-handler command-name="show-modal">` (the demo); a `form[method="dialog"]` closes it without JS.
- **Close control**: `.close`, or a `button` / `a` with `rel="prev"` (`:--dialog-close`), renders the `--v-icon-close` glyph; in the `header` it floats right.
- The `article` caps its width per breakpoint (510px / 700px), scrolls internally, and its `footer` right-aligns buttons.
- `dialog::backdrop` blurs and dims (`--v-modal-overlay-backdrop-filter`, `--v-modal-overlay-background-color`); scrolling stays inside the dialog.

## Custom hosts

`[role="dialog"]` / `.tag-dialog` (`:--dialog`) get the same layout; open state is `[open]` or `aria-expanded="true"`. Pseudo-elements cannot be aliased, so a custom host dims with a **sibling** element: `[role="presentation"]` or `.tag-backdrop` as the dialog's first child (`:--dialog-backdrop-aliases`) — `<content-drawer>` uses this. `.absolute` on the dialog positions it (and its backdrop) inside a `position: relative` parent instead of the viewport.

Element authors reuse the exact same dimmer through the `modal-backdrop` mixin — see [Themes & layers](./THEMES.md).
