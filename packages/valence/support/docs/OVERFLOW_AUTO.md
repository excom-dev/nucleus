# Overflow auto

Wrap wide content in `.overflow-auto` to scroll it inside its box; `.show-scrollbar` keeps a styled scrollbar visible.

## Usage

<include-content data-demo="overflow-auto"></include-content>

```html
<div class="overflow-auto">
  <table>…</table>
</div>
```

`.show-scrollbar` forces `overflow-y: scroll` with a slim themed thumb (`--v-muted-color`) — useful for panels whose content changes height.
