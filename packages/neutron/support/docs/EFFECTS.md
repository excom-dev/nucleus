# Effects

A handler describes what should change; Neutron applies it in a fixed order and batches the reactions.

## Effect keys

An effect is a plain object whose keys are instructions for the matched element:

| Key | Meaning |
| --- | --- |
| `<prop>: value` | Set a declared prop or any existing element property. Unknown properties throw. |
| `<elementProp>: { … }` | **Child effect** — an effect applied to the element held in an element-typed prop. The prop must already hold an element; `null` clears it. |
| `style: { … }` | Merged into `el.style`, not replaced. Prefer a state attribute and let CSS style it. |
| `emit` / `broadcast: [type, init?]` | Dispatch one event; `emits` / `broadcasts: [[type, init?], …]` dispatch several. Fires after everything else in the effect. |
| `command: [name, { target?, source? }]` | Invoke a command at `target` (default: the element) — see [Commands](./COMMANDS.md); `commands: [[…], …]` for several. Fires with the emits. |
| `addListener` / `removeListener` / `toggleListeners` / `removeAllListeners` / `…Broadcast…: [args]` | Listener management (see [Events](./EVENTS.md)). Callbacks are plain functions — pass a `defineMethods` method when the callback should itself return an effect. |
| `<method>: [args]` | Call a defined or native method with these arguments (`focus: []`, `setCustomValidity: ["Required"]`). The value must be an array. |
| `returns: value` | Value returned to the caller of a method. Ignored in child effects. |

## Order

Within one effect: `returns` → remove listeners → add listeners → element props → child effects → other props → method calls → `provision` → emits / broadcasts / commands.

## Nothing to do

Return `undefined` / `null` / `false` / `""` / `0` for "nothing to do".

## Arrays of effects

Return an **array** to run several effects in sequence — useful when a later effect depends on an earlier one:

```ts
Neutron({
  tag: "focus-host",
  props: {
    inputEl: { type: HTMLInputElement, store: "weak" },
    isFocused: Boolean,
  },
})
  .defineMethods({
    handleFocus: () => ({ isFocused: true }),
  })
  .onConnected((el) => [
    { inputEl: el.querySelector("input") }, // 1. store the child
    { inputEl: { addListener: ["focus", el.handleFocus] } }, // 2. wire it
  ]);
```

Any lifecycle or method may return an array. `returns` values are collected: none → `undefined`, one → the value, several → an array.
