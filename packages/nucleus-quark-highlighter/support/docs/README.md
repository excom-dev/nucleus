# nucleus-quark-highlighter

Quark sheets and Nucleus-style HTML, highlighted and formatted in VS Code / Cursor — the same grammar that colors every code block on this site.

The **Nucleus & Quark Syntax Highlighter** extension adds a Quark language for `.quark` files, highlights Quark inside `<quark-sheet>` in HTML, and gives custom elements and dashed attributes their own color so Adapters and their state stand apart from native markup. Tags, custom tags, attributes and custom attributes share one palette in both grammars, so a sheet and the markup it orchestrates read the same way.

```html
<provider-fetch src-url="/api/todos" should-fetch>
  <ul></ul>
  <quark-sheet>
    provider-fetch[is-success] {
      $todos: prop("provision").body;
      ul { content: iterate($todos); }
    }
  </quark-sheet>
</provider-fetch>
```

## Features

- **Quark language** `.quark` files with CSS-familiar highlighting, folding, bracket matching and `/* */` comments; Quark's at-rules — `@use`, `@scope`, `@on` with its event list, `@dispatch` / `@command`, `@view-transition`, `@delay`, `@warn` / `@debug` / `@error` — color their names, options groups, durations, messages and blocks
- **Quark's language, nothing else** Quark is not SCSS and not a CSS superset: every other at-rule (`@media`, `@mixin`, `@if`, `@keyframes`, …) and `%placeholder` selectors are colored as errors, because Quark's parser rejects them
- **Inline sheets** Quark inside `<quark-sheet>` in HTML is highlighted as Quark
- **Custom elements stand out** Dashed tags / dashed attributes get their own color in HTML and in Quark selectors; a dashed tag keeps that color wherever it appears in a selector — attribute-qualified, inside `:is()` / `:not()` / `:has()`, or before a pseudo-class or pseudo-element
- **Format Document** `.quark` files format with `@excom/quark-formatter` (`Shift+Alt+F`)
- **Format inline sheets** `Quark: Format <quark-sheet> blocks` formats every sheet in the open HTML file
- **File icon** `.quark` files carry the Quark icon in the explorer and tabs
- **Shiki grammar** `@excom/nucleus-quark-highlighter/shiki` highlights Quark / Nucleus HTML in docs and static sites

## Installation

Install **Nucleus & Quark Syntax Highlighter** from the editor's Extensions view, or from the registries directly:

- **VS Code** — [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=excom-dev.nucleus-quark-highlighter), or `ext install excom-dev.nucleus-quark-highlighter` in Quick Open
- **Cursor / VSCodium / Windsurf** — [Open VSX](https://open-vsx.org/extension/excom-dev/nucleus-quark-highlighter)

To install a build by hand, download `nucleus-quark-highlighter-<version>.vsix` from the [GitHub releases](https://github.com/excom-dev/nucleus/releases) and run `code --install-extension <file>` (`cursor --install-extension` in Cursor).

For docs sites and build tooling the grammar is also on npm:

```bash
npm install @excom/nucleus-quark-highlighter
```

## Usage

Open a `.quark` file and the language mode is **Quark**. Open any HTML file and `<quark-sheet>` bodies, custom elements and dashed attributes are colored without further setup.

### Formatting

- **`.quark` files** — Format Document (`Shift+Alt+F`, or format-on-save) reformats the whole file
- **Inline sheets in HTML** — run **Quark: Format `<quark-sheet>` blocks** from the Command Palette; every sheet body in the active file is formatted and re-indented one level past its tag

Inline sheets need the command because VS Code's HTML formatter only formats the `<style>` / `<script>` bodies it knows about and offers no hook for custom tags. A sheet that does not parse is left untouched and the reason appears in the status bar.

### Shortcuts

`Cmd+/` (`Ctrl+/`) and `Shift+Alt+A` both toggle `/* */` comments — Quark has no `//` line comments, so a sheet stays tokenizable by a CSS engine.

### Highlighting with Shiki

The extension's TextMate grammars are exported for [Shiki](https://shiki.style):

```js
import { createHighlighter } from "shiki";
import { shikiLangs } from "@excom/nucleus-quark-highlighter/shiki";

const highlighter = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["html", "css", ...shikiLangs],
});

highlighter.codeToHtml(source, { lang: "quark", theme: "github-dark" });
```

`quark` highlights standalone sheets. `html-custom-elements` is an injection: once registered, every `html` block gets custom-element / dashed-attribute coloring and Quark highlighting inside `<quark-sheet>`. Load `css` alongside them; the Quark grammar embeds it.
