# Prop reactions

React to one prop, or a batch of them, with the previous values in hand.

## Handlers

```ts
Neutron({ tag: "echo-field", props: { fieldValue: String, isFilled: Boolean } })
  .onPropSet("fieldValue", () => ({
    /* fieldValue became truthy for its type */
    isFilled: true,
  }))
  .onPropUnset("fieldValue", () => ({
    /* fieldValue became falsy / removed */
    isFilled: false,
  }))
  .onPropChanged("fieldValue", ({ fieldValue }, previous) => ({
    /* any change, including unset → set; `previous.fieldValue` is the old value */
    emit: ["echo-field-change", { detail: { fieldValue, previous: previous.fieldValue } }],
  }))
  // one handler for a batch of props — runs when any of them changed
  .onEffect(["fieldValue", "isFilled"], (el, previous) => ({
    emit: ["echo-field-effect", { detail: { previous } }],
  }));
```

`onPropChanged` and `onEffect` take one name or an array of names. The second argument maps every prop that changed in the batch to its **previous** value.

## Mount gating

Reactions run only on mounted elements. Changes made before the first connect (attributes parsed from HTML, props set on a detached element) are kept and flushed as one batch on first mount, so reaction handlers always see the settled initial state.

## No self-writes

A handler must not set the same prop it is reacting to — Neutron throws a `NeutronError`. Child effects on element-typed props are the exception, so `.onPropSet("inputEl", () => ({ inputEl: { addListener: [...] } }))` is allowed.
