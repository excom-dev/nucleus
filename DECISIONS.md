# DECISIONS — `@excom/kit-logger`

## Node summarization is recursive and runs after `formatArgs` — 2026-09-11

Decision: `summarizeLogArg` walks plain objects and arrays (depth-limited,
cycle-safe) and replaces every DOM node with `<tag>` / `<tag#id>` /
`[Node type=N]`. It is applied to the **output** of `formatArgs`, so a
custom formatter (Quark's table layout) cannot bypass it. Exported for
reuse.

Context: `QuarkLogger.error({ element, … })` printed a full happy-dom
node tree (~2,700 lines) in `rush retest`; the old summarizer only checked
top-level args and was skipped entirely by custom `formatArgs`.

Reasoning: The node is never the useful part of a log line; nesting and
formatting are the two ways it escaped, so both are closed at the one
place every line passes through.

Status: active
