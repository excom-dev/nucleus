# Code

`code`, `kbd`, `samp` and `pre` share the monospace tokens; `pre > code` becomes a scrollable block.

## Usage

<include-content data-demo="code"></include-content>

```html
<p>Press <kbd>⌘</kbd> <kbd>K</kbd> to run <code>build</code>.</p>
<pre><code>npm install @excom/valence</code></pre>
```

- Inline `code` / `samp`: `--v-code-background-color` / `--v-code-color`, small padding, `0.75em`.
- `kbd`: inverted (`--v-code-kbd-background-color` / `-color`).
- `pre`: block, `overflow-x: auto`, `--v-spacing` padding on the inner `code` / `samp`.

Aliases: `[role="code"]` / `.tag-code`, `.tag-pre`, `.tag-kbd`, `.tag-samp`.
