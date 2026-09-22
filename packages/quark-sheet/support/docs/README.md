# quark-sheet

Drop a Quark sheet next to your markup — bind, render, and react without a component runtime.

<include-content data-demo="simple"></include-content>

## Features

- **Sibling scope** Sheet + targets share a parent — Quark watches that host
- **Global sheets** `is-global` runs top-level rules document-wide
- **Inline or remote** Paste Quark in the element, or load `src-url`
- **Lifecycle state** `is-loading` / `is-success` / `is-error` + matching events (from [loadable-element](/nucleus/packages/loadable-element))
- **Reload** The `--reload` command drops the shared cache entry for `src-url` and fetches again
- **Auto (un)register** Connect registers; disconnect tears down cleanly

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Place `<quark-sheet>` under the same parent as the elements it should orchestrate.
Inline Quark text is enough for most apps.

```html
<section>
  <quark-sheet>
    details[open] summary { content: "Panel Open"; }
    details:not([open]) summary { content: "Panel Closed"; }
  </quark-sheet>
  <details>
    <summary></summary>
    <p>This is the panel content.</p>
  </details>
</section>
```

By default the sheet is scoped to its parent. Add `is-global` to run
top-level rules in the root context (e.g. reading a provider above the
host); rules inside an explicit `@scope { }` block stay host-scoped either
way. Language details live in the [`quark`](/nucleus/packages/quark) docs.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Provider data

`prop("provision")` reads a `<provider-fetch>` provision on success and fills a title.

<include-content data-demo="provider"></include-content>
