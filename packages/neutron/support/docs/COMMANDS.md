# Commands

Accept imperatives as native `command` events (the HTML Command API) instead of bubbling custom events.

## Why commands

A "fetch again", "submit", "open" or "reload" is an instruction aimed at one element, not a fact about the document and not an announcement. The platform models exactly that: a `<button command="…" commandfor="id">` dispatches a `CommandEvent` at its target — non-bubbling, cancelable, with `command` (the verb) and `source` (the button). Custom verbs start with `--`, like CSS custom properties; the browser reserves every other name for its built-ins (`show-modal`, `toggle-popover`, …).

Neutron elements handle those verbs with `onCommand`:

```ts
Neutron({ tag: "data-feed", props: { apiUrl: String } })
  .onCommand("--fetch", ({ apiUrl }, { source }) => ({
    emit: ["data-feed-submit", { detail: [apiUrl] }],
  }))
  .onCommand(["--pause", "--resume"], (_, { command }) => ({
    isPaused: command === "--pause",
  }))
  .define();
```

```html
<button type="button" command="--fetch" commandfor="feed">Refresh</button>
<data-feed id="feed" api-url="/api/items"></data-feed>
```

The button is a real button — keyboard, focus and ARIA come with it — and needs no custom element. `<event-handler command-name="--fetch" target-ref="…">` invokes the same command from any event (a relay, a keyboard shortcut) with a selector instead of an id.

## Semantics

- **One verb list per handler.** `onCommand(name | name[], fn)`; the handler receives the element and the `command` event (`event.command`, `event.source`). Names must be custom commands (`--verb`) — a built-in verb never reaches a custom element, so registering one throws.
- **At the target only.** `command` never bubbles: a command aimed at a descendant is not yours. Tag-prefixing the verb is therefore pointless; use short verbs (`--submit`, `--reload`, `--open`).
- **Cancelable, after dispatch.** Handlers run in a microtask after the dispatch completes and are skipped when any listener called `preventDefault()` — a Quark `@on command` handler or app JS can veto. The delay is a microtask, not a task, so the user activation of the click that invoked the command survives for permission prompts and popups.
- **No payload.** A `CommandEvent` carries no `detail`. State the inputs on the target as attributes before invoking, or read the invoker's `data-*` through `event.source.dataset` — whitelisted against your own declared props (see [Define](./DEFINE.md#md-introspection)) so a caller cannot set private state.
- **`off*` twin.** `offCommand(name, fn)` unregisters like every other lifecycle.

## Invoking commands

Effects can invoke commands the way they emit events:

```ts
.onEventDefault("dismiss-watcher-dismiss", ({ targetEl }) => ({
  command: ["--close", { target: targetEl }],
  // several: commands: [["--a", { target }], ["--b", { target }]]
}))
```

`command: [name, { target?, source? }]` dispatches at `target` (default: the element itself) with the element as `source`. A custom verb dispatches a `command` event directly and works in every browser. A built-in verb (`show-modal`, `close`, `toggle-popover`) can only run through the platform: Neutron clicks an invisible proxy `<button command commandfor>` and removes it, and logs a warning where the Command API is missing. The same helpers are exported for app code: `invokeCommand(target, "--fetch", source)` and `createCommandEvent("--fetch", { source })` (falls back to a plain `Event` with the same fields where `CommandEvent` does not exist yet).

## Typing

`TCommandEvent` is the handler's event type. Document each verb with a `@command` JSDoc tag on the element so it renders in the API reference:

```ts
/**
 * @command --fetch - Re-runs the request with the current attributes.
 */
```
