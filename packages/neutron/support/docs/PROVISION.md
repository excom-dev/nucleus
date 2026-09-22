# Provision

One property carries everything rich an element publishes to the document, so Quark and app JS have a single place to read it.

## Declaring a provision

All public, rich data an element exposes to the document goes through one property: `provision`. Declare it as `provision: Object` (or a typed constructor), set it from an effect, and tag it `@provision` in JSDoc.

```ts
Neutron({
  tag: "provider-ping",
  props: { provision: Object },
})
  .onConnected(() => ({ provision: { at: Date.now() } }))
  .define();
```

## Reading it

Every set emits `neutron-provision` for app JS. Quark reads it on the element itself with `prop("provision")` and re-runs when it is assigned — assign a new object rather than mutating the old one.

```quark
provider-ping {
  $ping: prop("provision");
  [bind-at] { content: $ping.at; }
}
```

## Ordering

Within one [effect](./EFFECTS.md), `provision` is always applied last, so listeners of `neutron-provision` see every other prop already settled.
