# Events

Tag-prefixed custom events, cancelable default actions, cross-instance broadcasts, and listeners that clean themselves up.

## Emit, default actions, broadcasts

```ts
Neutron({
  tag: "save-button",
  props: {},
  events: {
    // emitted and listened to as `save-button-save`
    save: { prefixWithTag: true },
  },
  broadcasts: {
    "app-toast": {},
  },
})
  .onEvent("save", (_el, e) => {
    /* runs during dispatch, before the default action */
  })
  .onEventDefault("save", () => ({
    /* runs in the next task; skipped if e.preventDefault() was called synchronously */
    broadcast: ["app-toast", { detail: { message: "Saved" } }],
  }))
  .onBroadcast("app-toast", (_el, e) => {
    /* cross-instance channel */
  })
  .onConnected(() => ({
    emit: ["save", { detail: { id: 1 } }],
  }));
```

- `prefixWithTag` is off by default. When on, the configured short name is prefixed for `emit`, `onEvent`, `onEventDefault`, and `addListener` alike. Always prefix events with the tag name to avoid clashing with native events.
- `emit` defaults `bubbles` / `cancelable` / `composed` to `true`, returns the event, and warns when the element is not connected. Pass `target` in the init to dispatch from another element.
- `onEventDefault` runs only when the element itself is the event target, after the event has finished dispatching, and never when `preventDefault()` was called. Consumers cancel with `preventDefault()` instead of forking the element.
- `broadcast` dispatches a non-bubbling event on a shared channel (not on the element), so any instance of any element can `onBroadcast` it.
- An instruction aimed at the element ("submit", "reload", "open") is not an event of its own: handle it as a command — see [Commands](./COMMANDS.md).

## Listener cleanup

Listeners registered by `onEvent` / `onBroadcast` or added through [effects](./EFFECTS.md) (`addListener`, `addListeners`, …) are tracked per element: removed on disconnect, re-added on reconnect (`once` listeners are not re-added). `addListener` accepts a `target` option to listen on another node with the same cleanup.

## Typing events

Document Neutron-emitted events with `TEvent` plus `type` and `detail` — do not repeat the flags:

```ts
import { TEvent } from "@excom/neutron";

export type SaveButtonSaveEvent = TEvent & {
  type: "save-button-save";
  detail: { id: number };
};
```

Native listeners (form `submit`) are not Neutron emits — type those as the DOM event with its real flags (`composed: false` on `SubmitEvent`).
