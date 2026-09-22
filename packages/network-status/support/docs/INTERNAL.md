- `navigator.onLine` is not a reliable "can reach the internet" signal.
  Findings from the ws investigation: iOS Safari (and other WebKit
  embeds) can report `true` while on a captive portal or a cellular
  connection with no actual data path, and some Android WebViews lag
  behind the real link state by several seconds after a transition.
  Treat `is-online` as "the OS thinks it has a link", not as an
  end-to-end connectivity check — pair with an actual request/heartbeat
  if you need the stronger guarantee.
- Network Information API (`connection-type` / `effective-type` /
  `downlink` / `rtt`) is Chromium-only. Safari and Firefox never expose
  `navigator.connection`, so those fields stay `null` indefinitely on
  those browsers — this is expected, not a bug.
