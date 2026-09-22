# Props

Declare an element's state once; primitives become dashed attributes that CSS and Quark select on, rich values stay on the instance.

## Declaring props

Shorthand constructors reflect primitives to dashed attributes. Rich config adds defaults, validation, storage, and custom serialize / deserialize.

```ts
import { Neutron, TokenList } from "@excom/neutron";

Neutron({
  tag: "usage-meter",
  props: {
    unitLabel: String, // reflects ↔ `unit-label`
    maxCount: Number, // reflects ↔ `max-count`
    isOpen: Boolean, // presence attribute `is-open`
    featureTags: TokenList, // space-separated tokens ↔ `feature-tags`, read as `string[]`
    // non-reflecting by default:
    payload: Object,
    items: Array,
    srcPromise: Promise,
    // rich config:
    maxValue: {
      type: Number,
      defaultValue: () => 100,
      isValid: (n) => n > 0,
    },
    // element references are always weak — never pin another node:
    inputEl: { type: HTMLInputElement, store: "weak" },
  },
});
```

## Rich config keys

| Key | Purpose |
| --- | --- |
| `type` | Constructor. `String` / `Number` / `Boolean` / `TokenList` reflect to an attribute; everything else is instance-only. |
| `defaultValue` | `() => value`, returned when the prop is nullish or invalid. |
| `isValid` | `(value) => boolean`. Invalid values fall back to the default; for `TokenList` the invalid tokens are filtered out instead. |
| `attr` | Override the attribute name, or `false` to keep a primitive off the attribute. |
| `store` | `"weak"` holds the value in a `WeakRef` and derefs on read. Required for every prop that references another element, so a removed node can be collected. |
| `serialize` / `deserialize` | Transform on write / read. |

## TokenList

`TokenList` is exported by this package. It marks a space-separated attribute (`feature-tags="a b"`) whose property value is a plain `string[]` — the element-side equivalent of `class`. Prefer it over `Array` whenever the list belongs in the document, so CSS and Quark can select on it (`usage-meter[feature-tags~="a"]`).

## Built-in instance props

`isMounted`, `isMoving`, `isAdopted`, `wasMounted` exist on every element. They are instance-only; list them in `reflectDefaultProps: ["isMounted"]` to reflect them as attributes (`is-mounted`).

## Naming rules

Enforced at definition time or by convention:

- Custom attributes must contain a dash (`max-count`, `is-open`), so they can never collide with a native attribute — now or in the future. Dev mode warns on dash-less, `data-*`, and `aria-*` attributes.
- Booleans read as assertions: `is-loading`, `did-fail`, `has-rendered`, `should-fetch`.
- Events are tag-prefixed (`press-tracker-press`), never bare (`change`).
- Attribute names may not start with `q-`, `n-`, `on-`, or `off-` (reserved by Quark and Neutron).
- Prop names may not shadow Neutron internals or effect keywords (`returns`, `content`, lifecycle names, `_n_`, `_q_`).
- Private state and methods take a leading underscore.
- Loosely couple: element-typed props use `store: "weak"`, and anything else that holds a node is cleared in `onDisconnected`.
