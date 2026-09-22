# provider-storage

Read a JSON value out of `localStorage` / `sessionStorage` into `provision`,
declaratively — and keep it in sync across tabs. No app JS required to display
cached client state.

## Features

- **Declarative read** Point `key-name` at a storage key and read the result
- **Local or session** `store-name` picks `localStorage` (default) /
  `sessionStorage`
- **Live across tabs** A write from another tab re-reads and fires
  `provider-storage-changed`
- **Reactive to attributes** Changing `key-name` / `store-name` re-reads
  immediately
- **Tiny, read-only** Never writes

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

```html
<provider-storage key-name="user-preferences"></provider-storage>
<provider-storage key-name="checkout-draft" store-name="session"></provider-storage>
```

**Read-only.** It reads on every `key-name` / `store-name` set/change and never
writes. Removing `key-name` clears `provision` and both states.

**Live across tabs, not within one.** Browsers fire `storage` only in *other*
tabs, so:

- A write from another tab (or a `clear()` there) re-reads and fires
  `provider-storage-changed` — no app code needed. `sessionStorage` is
  per-tab, so this only applies to `store-name="local"`.
- A write by your own app code (`localStorage.setItem(...)`) in the same tab
  won't appear until you re-trigger a read — re-set `key-name` (e.g. to `""`
  and back) after writing.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Seed & re-read

Since this element never writes, the demo below seeds a value from a button
(re-setting `key-name` afterward to force the same-tab re-read) so you can see
it work without opening devtools. Open this page in a second tab and click
there too — this tab updates on its own.

<include-content data-demo="simple"></include-content>
