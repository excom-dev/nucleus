# nucleus-devtools

See exactly what every element did and why — Neutron lifecycles and Quark rule applications, live, inside Chrome DevTools.

The Nucleus DevTools extension adds an **Element** pane to the
Elements panel. Select any node and read its history and current state
from both halves of the Nucleus Stack:

- **Neutron** — every lifecycle effect the element applied (`onConnected()`,
  `onPropSet("label")`, …) with the exact props, events and calls it produced,
  plus the element's current props.
- **Quark** — every rule that matched the element, grouped per rule run
  (selector, the declarations it applied, the values they resolved to), plus
  the element's current `$variables`, Quark-written attributes and CSS custom
  properties, listeners and `iterate()` row context.

State is the DOM, so the Elements panel already shows *what* changed. This
pane shows *who* changed it and *how*.

## Features

- **Lifecycle history** Effects in order, nested by re-entrancy, with the lifecycle that fired them
- **Orchestration history** Matched rules per run: selector, declarations, resolved values, no-op / wipe / error status
- **Hover for source** Hover any key to see its declaration; hover a listener to see the expression that attached it
- **Current state** Props, `$variables`, attributes, custom properties, listeners, loop `item` / `index`
- **Live** New publications append as they happen; picking another node re-reads its history
- **Zero setup** Works on any page using `@excom/neutron` or `@excom/quark`; no app changes, no debug flags
- **Paint heatmap** A toolbar toggle overlays every Quark-painted element with its paint count, blue → red = fewest → most, for the whole document
- **Definition audits** Every Neutron element definition is checked for non-dashed, `data-` / `aria-` attribute names and prop names that override `HTMLElement` members; warnings go to the page console
- **Agent tools** Eleven selector-addressed, JSON-only tools (`diagnostics`, `state_snapshot`, `explain_attribute`, …) for coding agents, discoverable by chrome-devtools-mcp and callable from any browser automation; a **Copy for AI** button in the pane produces a one-file bug report
- **Familiar** Styled after the Styles tab — same type, colors and hairlines

## Installation

> **Pending review.** The extension has been submitted to the Chrome Web Store and is awaiting Google's approval. Until it is listed, install it from the release zip:
>
> 1. Download `nucleus-devtools-<version>-chrome.zip` from the [latest GitHub release](https://github.com/excom-dev/nucleus/releases) and unzip it.
> 2. Open `chrome://extensions` and switch on **Developer mode** (top right).
> 3. Click **Load unpacked** and pick the unzipped folder.
> 4. Reload any Nucleus Stack page that was already open, then open DevTools → Elements → **Element** pane.
>
> A build installed this way does not update itself; grab the next release zip to update. This note goes away once the store listing is live.

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/nucleus-devtools)
(also loads in Edge, Brave and other Chromium browsers).

To run a local build instead, download `nucleus-devtools-<version>-chrome.zip`
from the [GitHub releases](https://github.com/excom-dev/nucleus/releases),
unzip it, open `chrome://extensions`, enable *Developer mode* and choose
*Load unpacked*.

The extension collects no data and makes no network requests — see the
[privacy policy](./PRIVACY.md).

## Usage

1. Open DevTools on a page built with the Nucleus Stack.
2. Select an element in the Elements panel.
3. Open the **Element** pane in the sidebar (next to Styles / Computed) and
   switch between the **Neutron** and **Quark** tabs.

Pages opened before the extension was installed need one reload: the probe
records from the first byte of the document, so nothing is missed after that.

### Rows

Each row is one trigger and the changes it applied — a lifecycle handler for
Neutron, a rule run for Quark. Expand a value to walk into it; hover a key to
see the declaration that produced it.

```text
▾ provider-fetch[is-success] h1#title      ← the rule that matched
    content: "Hello devtools"              ← hover: content: $todo.title
    data-x: "(no-op)"                      ← preserve left it alone
```

Rows are muted for no-ops / wipes and red for a failed expression (which
never wipes — see [Orchestrating](/nucleus/docs/orchestrating)).

### Heatmap

Click the extension's toolbar icon and tick **Paint heatmap (whole
document)**. It is off by default and applies to every open tab for the
rest of the browser session. While on, each element Quark has painted since
the page loaded is overlaid with a translucent box and its paint count,
colored from blue (fewest paints) to red (most). The overlay is drawn by
the extension only: nothing is written to the page's elements, and turning
the toggle off removes it.

### Definition audits

When a page defines a Neutron element the extension checks its prop config
and warns in the page console (prefixed `[nucleus-devtools]`) about
custom attributes without a dash, attributes starting with `data-` /
`aria-`, and prop names that already exist on `HTMLElement`. Nothing is
logged for a clean definition.

### Agent tools

The probe the extension installs on every page also exposes a tool API for
coding agents, so an LLM can troubleshoot a Nucleus Stack app (development
**or production**) without any change to the app: the runtime only carries
the dormant hook it always had. Every tool takes and returns plain JSON,
addresses elements by CSS selector (results include a unique selector for
each element they mention, ready to pass back), caps its output, and never
writes to the page.

| Tool | Answers |
| --- | --- |
| `diagnostics` | Failed Quark expressions, Neutron effect errors, loop-guard trips, definition audits. Start here. |
| `state_snapshot` | The application State as a tree: attributes, each element's `provision`, Quark `$variables`, text. |
| `inspect_element` | Everything about one element: props, `$variables`, listeners, matching rules, recent history. |
| `explain_attribute` | Every recorded write to one attribute (rule + expression + result, or Neutron effect), plus the rules that could write it. |
| `list_sheets` | Registered Quark sheets, optionally with source and rules. |
| `matching_rules` | Rules matching an element right now, in the order they apply. |
| `evaluate_expression` | A Quark expression evaluated in an element's context (`$bindings`, `attr()`, `prop()`, `@use` modules). |
| `trace` | Page-wide publication log, filterable by path, element and `sinceSeq` for "what happened after I clicked". |
| `list_definitions` | Neutron element definitions seen on the page with props and audit findings. |
| `heatmap_top` | Most-painted elements since load. |
| `dump` | One JSON bug report bundling all of the above (what **Copy for AI** copies). |

Descriptions carry the ASO facts an agent needs (rules never revert, later
rules win, attributes not classes drive rules, `prop("provision")` for
rich data), so a fresh model can reason correctly from the first call.

#### With chrome-devtools-mcp (recommended)

The tools register with [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)'s
third-party developer tools protocol. Configure the server with
`--autoConnect` (drives your real Chrome profile, where the extension is
installed; Chrome 144+, one-time toggle in `chrome://inspect/#remote-debugging`)
and the experimental third-party category:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest", "--autoConnect", "--categoryExperimentalThirdParty"]
    }
  }
}
```

The agent then sees a **Nucleus Stack** tool group via `list_3p_developer_tools`
and calls each tool with `execute_3p_developer_tool`. Chrome for Testing /
`--browserUrl` setups work too, as long as the extension is loaded in that
profile.

#### With any `evaluate` (Playwright MCP, Cursor browser, Puppeteer, …)

The same functions live on the page global, so no protocol support is needed:

```js
__NUCLEUS_DEVTOOLS__.listTools();                       // descriptors with JSON Schemas
__NUCLEUS_DEVTOOLS__.tools.diagnostics({});
__NUCLEUS_DEVTOOLS__.tools.explain_attribute({ selector: "#cart", name: "is-open" });
await __NUCLEUS_DEVTOOLS__.tools.evaluate_expression({ selector: "#cart", expression: "prop(\"provision\").items.length" });
```

#### Without the extension

`agent-tools.js` (in the release zip, or `.output/chrome-mv3/agent-tools.js`
after `pnpm run build`) installs the same probe and tools when evaluated in
a page: `evaluate_script` with the file's contents, Playwright
`addScriptTag`, or a `<script>` tag when the page's CSP allows. Evaluating
it returns `{ installed, tools, hint }`. What it cannot do is see the past:
histories start at injection, `neutron/defined` records from boot are
missed, and chrome-devtools-mcp only re-discovers tools on
`list_3p_developer_tools`, so call that after injecting.

#### Copy for AI

The pane's **Copy for AI** button puts `dump()` on the clipboard as pretty
JSON: the State tree, every sheet with source and rules, definitions,
diagnostics, the last 200 publications and the paint heatmap. Paste it into
a chat with the failing selector and the question.

#### Trade-offs

- **Extension required for boot-time history.** Sites run without any
  runtime cost, but the agent's browser must have the extension (or inject
  `agent-tools.js` and accept a history that starts late).
- **Experimental protocol.** chrome-devtools-mcp's third-party tools need
  `--categoryExperimentalThirdParty` and may change; the page-global API is
  the stable fallback.
- **Read-only by design.** `evaluate_expression` runs Quark's evaluator,
  which cannot assign; a `@use` function it calls can still side-effect.
- **Caps.** 500 trace records, 200 diagnostics, 200 history records per
  element and producer, 500 snapshot nodes by default; long strings are
  clipped with `… [+n]`.

#### Snippet for `AGENTS.md`

```md
When debugging a Nucleus Stack page, use the "Nucleus Stack" DevTools tools
(chrome-devtools-mcp `list_3p_developer_tools`, or
`__NUCLEUS_DEVTOOLS__.tools.*` via evaluate). Order: `diagnostics` →
`state_snapshot` → `explain_attribute` for the attribute that looks wrong →
`matching_rules` / `evaluate_expression` to test the fix before editing the
sheet. State lives in attributes and `provision`; rules never revert and the
later matching rule wins.
```

### Programmatic hook

The extension installs the same global hook that `Neutron.attachDevtools()`
/ `Quark.attachDevtools()` accept, so tests and tooling can subscribe without
the browser:

```ts
import { Quark } from "@excom/quark";

Quark.attachDevtools({
  version: 1,
  publicize: (path, meta) => console.log(path.join("/"), meta),
});
```

Publications are `["neutron", …]` / `["quark", …]` paths with JSON-safe
metadata; see the [neutron](/nucleus/packages/neutron) and [quark](/nucleus/packages/quark)
package pages for the full list.
