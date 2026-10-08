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

Documentation: https://nucleus.excom.dev/packages/nucleus-devtools

**Category**: Developer Tools

**Language**: English

**Store icon** (128×128): `public/icon/128.png`

**Small promo tile** (440×280): `support/store/promo-small-440x280.png` (source `promo-small-440x280.svg`; re-render with `@resvg/resvg-js`, `loadSystemFonts: true`)

**Screenshots** (1280×800 PNG, 1–5): `support/store/screenshots/` — `1-quark-tab.png`, `2-neutron-tab.png` (owner's captures, metadata stripped, letterboxed from 1309×948; a capture of a 1280×800 or any 16:10 window avoids the side bars). Still worth adding: the hover tooltip over a key, and the heatmap overlay with the toolbar popup. Never drop screenshots into `public/` — everything there ships inside the extension zip.

**Official URL**: https://excom.dev
**Homepage URL**: https://nucleus.excom.dev/packages/nucleus-devtools
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

**Privacy policy URL**: https://excom.dev/nucleus/packages/nucleus-devtools/privacy (live today; becomes https://nucleus.excom.dev/packages/nucleus-devtools/privacy once the restructured site is deployed on that domain — update the dashboard then)

## Distribution

**Visibility**: Public
**Regions**: all
**Trader / non-trader** (EU DSA): non-trader (no goods or services sold through the item; keeps the developer address off the listing)
**Payments**: free

## Account

**Developer name** (public): excom
**Contact email** (public, must be verified): the excom alias mailbox, never a personal address
