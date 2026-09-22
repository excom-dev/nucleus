# Define

`define()` registers the element; the registered class then carries its own configuration for anyone who needs to inspect it.

## define()

`define(tag?, options?)` registers the element. Both default to the config (`tag`, `definitionOpts`) and are passed straight to `customElements.define`. Defining an already-registered tag logs a warning instead of throwing.

## Introspection

The defined element class carries its runtime configuration as two static methods. Reach the class through the registry or an instance's constructor:

```ts
const Drawer = customElements.get("content-drawer") as typeof NeutronElement;
Drawer.getConfig();                            // { tag, props, events, broadcasts, methods, lifecycles, … }
Drawer.getPropConfig({ attr: "open-stage" });  // { prop: "openStage", attr: "open-stage", type: Number, … }
(el.constructor as typeof NeutronElement).getPropConfig({ prop: "isOpen" });
```

`getConfig()` returns the `RuntimeConfig` built by `define()` (`undefined` before it); `getPropConfig({ attr })` / `getPropConfig({ prop })` return one prop's `PropConfig` or `undefined`. Treat both as read-only. A typical use is whitelisting event payloads: keep only `detail` keys that name a declared, non-private prop before applying them as an effect (see `content-drawer`).
