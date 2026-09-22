# ARCHITECTURE — `@excom/kit-logger`

One class, no dependencies. `KitLogManager#<method>` → level gate →
`formatArgs([prefix, ...args])` → `summarizeLogArgs` → `console.<method>`.

The summarizer exists because happy-dom / browser elements `inspect` to
thousands of lines (internals, listener maps, parent chain). Owner rule
(2026-09-11): log output never serializes a DOM node — a label only.

Boundaries: no DOM writes, no transport, no buffering.
