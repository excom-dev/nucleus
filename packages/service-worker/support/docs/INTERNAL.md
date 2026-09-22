# Internal notes

## TODO: re-listen on reconnect

`onDisconnected` removes the `navigator.serviceWorker` listeners added for
`relay-events`, but if the element is later reconnected (moved in the DOM
counts as a disconnect + connect unless `isMoving` is set), `onConnected`
never re-attaches them — only `onPropChanged("relayEvents", ...)` does, and
that only fires on an actual attribute change, not on reconnect.

Fix: either re-run the `relayEvents` listener setup from `onConnected` (skip
when `wasMounted` is true, mirroring the `swContainer` re-detection guard),
or track listener state independently of the prop-change handler.
