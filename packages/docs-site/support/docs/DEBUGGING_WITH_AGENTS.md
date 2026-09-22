# Debugging with Agents

An LLM agent can troubleshoot a Nucleus Stack app the way you would in DevTools: read the State, ask why an attribute has its value, test an expression, then edit the sheet. The [Nucleus DevTools](/nucleus/packages/nucleus-devtools) extension exposes that as tools, on development and production pages alike, with no change to the app and no runtime cost.

## What the agent gets

Eleven read-only tools. Each takes plain JSON, returns plain JSON, and addresses elements by CSS selector; every element in a result carries a unique `selector` the agent can pass straight back.

| Tool | Use it when |
| --- | --- |
| `diagnostics` | Anything is wrong. Failed expressions, effect errors, loop-guard trips, definition audits. |
| `state_snapshot` | You need the State: an element tree with attributes, `provision` data and Quark `$variables`. |
| `inspect_element` | One element: props, `$variables`, listeners, the rules matching it now, its recent history. |
| `explain_attribute` | "Why is `is-open` still set?" Every recorded write (rule + expression + result, or Neutron effect), the rules that could write it. |
| `list_sheets` / `matching_rules` | Which sheets exist, which rules apply to an element and in what order. |
| `evaluate_expression` | Test a Quark expression in an element's context before editing the sheet. |
| `trace` | What happened after an action: page-wide publications, filterable by element, path, or `sinceSeq`. |
| `list_definitions` | Which Neutron elements are defined, their attributes, audit findings. |
| `heatmap_top` | Which elements paint most (fan-out / cycle triage). |
| `dump` | One JSON bug report of all of the above. |

Tool descriptions carry the facts an agent tends to get wrong about this stack: rules never revert when they stop matching, the later matching rule wins, attributes (not classes) drive rules, rich data lives in `prop("provision")`.

## Setup

### chrome-devtools-mcp (recommended)

Install the extension in the Chrome you debug with, then point [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) at that profile with the third-party tools category enabled:

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

`--autoConnect` drives your real browser (Chrome 144+, one-time toggle in `chrome://inspect/#remote-debugging`). The agent then finds a **Nucleus Stack** group through `list_3p_developer_tools` and calls tools with `execute_3p_developer_tool`, alongside chrome-devtools-mcp's own navigation, DOM, console and network tools.

### Any other browser automation

The same functions live on the page, so Playwright MCP, Cursor's browser, Puppeteer or a console work without flags:

```js
__NUCLEUS_DEVTOOLS__.listTools();
__NUCLEUS_DEVTOOLS__.tools.diagnostics({});
__NUCLEUS_DEVTOOLS__.tools.explain_attribute({ selector: "#cart", name: "is-open" });
await __NUCLEUS_DEVTOOLS__.tools.evaluate_expression({ selector: "#cart", expression: 'prop("provision").items.length' });
```

### No extension available

Evaluate `agent-tools.js` from the extension's release zip in the page (`evaluate_script`, `addScriptTag`, or a `<script>` when CSP allows). It installs the same tools; history starts at injection, so boot-time records are missed. With chrome-devtools-mcp, call `list_3p_developer_tools` after injecting.

## A workflow that works

1. `diagnostics` — an error usually names the attribute and the expression.
2. `state_snapshot` on the failing region — confirm what the State actually is.
3. `explain_attribute` on the attribute that looks wrong — the last write stands; find the rule that should have written its inverse.
4. `matching_rules` / `evaluate_expression` — test the fix against the live element.
5. Edit the sheet, reload, `trace({ sinceSeq })` to confirm the new run.

Add this to your `AGENTS.md` so the agent starts there:

```md
When debugging a Nucleus Stack page, use the "Nucleus Stack" DevTools tools (chrome-devtools-mcp `list_3p_developer_tools`, or `__NUCLEUS_DEVTOOLS__.tools.*` via evaluate). Order: `diagnostics` → `state_snapshot` → `explain_attribute` for the attribute that looks wrong → `matching_rules` / `evaluate_expression` to test the fix before editing the sheet. State lives in attributes and `provision`; rules never revert and the later matching rule wins.
```

## Sharing a bug

The extension's **Element** pane has a **Copy for AI** button. It copies `dump()` as JSON: the State tree, every sheet with source and rules, definitions, diagnostics, the last 200 publications and the paint heatmap. Paste it into a chat with the failing selector and the question.

## Limits

- Tools are read-only. `evaluate_expression` runs Quark's evaluator, which cannot assign; a `@use` function it calls can still side-effect.
- Output is capped: 500 trace records, 200 diagnostics, 200 history records per element and producer, 500 snapshot nodes by default; long strings are clipped with `… [+n]`.
- chrome-devtools-mcp's third-party tools are experimental and need the flag above; the page-global API is the stable fallback.
- Boot-time history needs the extension installed before the page loads (reload once after installing).
