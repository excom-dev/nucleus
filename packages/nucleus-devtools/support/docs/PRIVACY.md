# Privacy policy

Nucleus DevTools collects no data. Everything it records stays inside your browser and is discarded when the page or tab closes.

## What the extension does

The extension installs a small probe on every page you open. The probe is dormant unless the page uses `@excom/neutron` or `@excom/quark`; on those pages it records element lifecycles and Quark rule runs so the **Element** pane in Chrome DevTools can show them. The optional paint heatmap draws an overlay inside the page; it writes nothing to the page's elements and disappears when switched off.

## What is collected, stored or transmitted

- **Collected:** nothing. The extension has no analytics, no telemetry, no crash reporting and no account.
- **Stored:** one boolean, the heatmap toggle, in `chrome.storage.session`. It is cleared when the browser closes.
- **Transmitted:** nothing. The extension makes no network requests and contains no remote code.

Recorded lifecycle and rule data lives in the memory of the page it came from and is never persisted, copied to other tabs or sent anywhere. **Copy for AI** places a JSON report on your clipboard only when you click it; where you paste it is up to you.

## Permissions

- **Access to all sites** (`<all_urls>` content scripts): the probe must be present from the first byte of any page that might use the Nucleus Stack, and the extension cannot know which pages those are in advance. On every other page the probe does nothing.
- **storage:** the heatmap toggle above.

## Contact

Questions about this policy: open an issue at [github.com/excom-dev/nucleus](https://github.com/excom-dev/nucleus/issues).

Last updated 2026-09-23.
