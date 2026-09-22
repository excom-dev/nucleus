- `partial-support` and `granted-permissions` attributes exist on the
  element but are never populated by `setFeatures` — only `full-support` /
  `no-support` (and the matching `.provision` arrays) are computed today, via
  simple presence checks in `FEATURE_CHECKS` (`detect-features.ts`). Don't
  advertise partial support / granted permissions in public docs until
  this is implemented.
- Keep new detections cheap and sync (`"x" in navigator` /
  `"X" in globalThis`). Skip capability probes, permission queries, and
  user-gesture-gated APIs.
