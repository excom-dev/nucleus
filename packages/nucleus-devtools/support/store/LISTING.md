# Chrome Web Store listing

Copy for the Developer Dashboard. Fields are named as the dashboard names
them (2026). The zip to upload is `.output/nucleus-devtools-<version>-chrome.zip`
from `pnpm run zip`.

## Store listing

**Title** (from manifest): Nucleus DevTools

**Summary** (from manifest, 132 chars max):
Element sidebar — Neutron lifecycle and Quark orchestration publications for the selected element

**Description**:

See exactly what every element did and why — Neutron lifecycles and Quark rule applications, live, inside Chrome DevTools.

Nucleus DevTools adds an "Element" pane to the Elements panel for pages built with the Nucleus Stack (@excom/neutron, @excom/quark). Select any node and read its history and current state:

• Neutron — every lifecycle effect the element applied, with the exact props, events and calls it produced, plus its current props.
• Quark — every rule that matched the element, grouped per run: selector, declarations, resolved values, no-op / wipe / error status; plus its current $variables, Quark-written attributes and custom properties, listeners and iterate() row context.
• Hover any key to see the declaration that produced it.
• Live — new publications append as they happen.
• Paint heatmap — a toolbar toggle overlays every Quark-painted element with its paint count.
• Definition audits — Neutron element definitions are checked for attribute-naming mistakes; warnings go to the page console.
• Agent tools — eleven JSON tools (diagnostics, state_snapshot, explain_attribute, …) for coding agents, discoverable by chrome-devtools-mcp, and a "Copy for AI" button that produces a one-file bug report.

Zero setup: no app changes, no debug flags. Works on any page using the Nucleus Stack; does nothing on other pages. Collects no data and makes no network requests.

Documentation: https://excom.dev/nucleus/packages/nucleus-devtools

**Category**: Developer Tools

**Language**: English

**Store icon**: `public/icon/128.png` (the dashboard reads it from the manifest; upload the same file if asked)

**Screenshots** (1280×800 or 640×400, PNG, 1–5): take on https://excom.dev/nucleus/examples/todos with DevTools docked right, Elements panel, Element pane open:
1. Quark tab — a `<li>` inside the todo list selected, rule rows expanded.
2. Neutron tab — a `provider-fetch` or `content-drawer` selected, lifecycle rows expanded.
3. Hover state — the declaration tooltip over a key.
4. Heatmap — toolbar popup with the toggle on and the overlay visible on the page.

**Official URL**: https://excom.dev
**Homepage URL**: https://excom.dev/nucleus/packages/nucleus-devtools
**Support URL**: https://github.com/excom-dev/nucleus/issues

## Privacy practices

**Single purpose description**:
Adds a Chrome DevTools sidebar pane that shows, for the selected element, the Neutron lifecycle effects and Quark rule runs recorded on pages built with the Nucleus Stack, plus related debugging aids (paint heatmap, definition audits, JSON tools for coding agents).

**Permission justification — storage**:
Holds a single session-scoped boolean: whether the paint-heatmap overlay is switched on. Cleared when the browser closes.

**Host permission justification — `<all_urls>` (content scripts)**:
The probe must be installed at document_start on any page that might use the Nucleus Stack; the extension cannot know which pages those are in advance, and a page opened before the probe exists loses its lifecycle history. On pages without @excom/neutron or @excom/quark the probe stays dormant. No data leaves the page.

**Are you using remote code?** No.

**Data usage** — tick nothing under "What user data do you plan to collect?". Certify:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**: https://excom.dev/nucleus/packages/nucleus-devtools/privacy

## Distribution

**Visibility**: Public
**Regions**: all
**Trader / non-trader** (EU DSA): non-trader (no goods or services sold through the item; keeps the developer address off the listing)
**Payments**: free

## Account

**Developer name** (public): excom
**Contact email** (public, must be verified): the excom alias mailbox, never a personal address
