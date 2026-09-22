# Writing from JS

Every element carries `element.quark`, shaped like `element.style`: the sanctioned way for app JS to write a `$variable` that rules read.

## `element.quark`

| Method | Effect |
| --- | --- |
| `setProperty(name, value)` | Stores the binding on that element (it becomes the owner) and re-runs readers below it, in every sheet. Returns `true` when the value changed. |
| `setProperties({ … })` | Stores several bindings, then announces them, so a reader of two names runs once with both. |
| `removeProperty(name)` | `unset`: deletes the binding so readers fall through to an ancestor. |
| `getPropertyValue(name)` | What a rule on that element would read (nearest owner, self first). |

`name` may be written with or without the `$`. Change detection is by value (a new object is a change, an in-place mutation is not), the same rule a declaration follows. It is State, not an event: a value written before a sheet registers is read on the sheet's first run.

```quark
:scope { $count: 0; }
button { @on click (handle: incrementFromJs(closest("[data-demo-counter]"))); }
output { content: "Clicked #{$count} times"; }
```

```js
// JS module
export const incrementFromJs = (owner) => () => {
  const current = Number(owner.quark.getPropertyValue("$count") ?? 0);
  owner.quark.setProperty("$count", current + 1);
};
```

<include-content data-demo="js-api"></include-content>

## Rules of thumb

- One writer per name per element: a rule that declares `$name` on the same element rewrites the JS value when its declaration re-runs (last writer wins). Initialize in the sheet and update from JS, or write from JS only.
- Primitives that CSS or a selector should see belong in attributes (`setAttribute` + `attr()`, serializable and selectable); `element.quark` earns its place for rich values and for `$name` reads across a subtree.
- DevTools shows a JS write as a binding change without a sheet.
