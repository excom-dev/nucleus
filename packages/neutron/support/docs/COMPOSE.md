# Compose

Combine builders into one element — the pattern behind the Abortable / Fetchable / Renderable bases and packages like `<include-content>`.

## Stacking builders

```ts
const DisabledBase = Neutron({
  tag: "disabled-base",
  props: { isDisabled: Boolean },
}).onPropChanged("isDisabled", ({ isDisabled }) => ({
  ariaDisabled: isDisabled ? "true" : null, // native reflected property ↔ `aria-disabled`
}));

export const FancyButton = Neutron.compose([
  DisabledBase,
  Neutron({
    tag: "fancy-button",
    props: { isPressed: Boolean },
  }),
]).onEvent("click", ({ isDisabled, isPressed }) =>
  isDisabled ? undefined : { isPressed: !isPressed, emit: ["fancy-button-press"] }
);

FancyButton.define();
```

## Merge rules

Props, events, and broadcasts merge (later wins); methods and lifecycles concatenate in order; `tag` comes from the last builder. Bases are deep-cloned, so composing never mutates them.

Composing is also how you add props to a packaged element you did not write — see [Recompose](./RECOMPOSE.md).
