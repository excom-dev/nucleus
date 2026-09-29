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

## Handing a value to the document

`element.quark` is for rich values app JS already holds, such as feature flags or a messages dictionary. App JS writes them on a shared ancestor, and every rule reading them below it picks them up:

```js
// app JS, holding `flags` and `messages`
document.querySelector("main").quark.setProperties({
  "$app-flags": flags,
  "$app-messages": messages,
});
```

```quark
[data-flag] { hidden: not $app-flags[attr("data-flag")]; }
[data-message] { content: $app-messages[attr("data-message")]; }
```

An event that becomes State is an `@on` block (see [`@on`](./ON.md)), and a value computed from State is a pure module function (see [`@use`](./USE.md)); neither needs `element.quark`.

<include-content data-demo="js-api"></include-content>

## Rules of thumb

- One writer per name per element: a rule that declares `$name` on the same element rewrites the JS value when its declaration re-runs (last writer wins). Initialize in the sheet and update from JS, or write from JS only.
- Primitives that CSS or a selector should see belong in attributes (`setAttribute` + `attr()`, serializable and selectable); `element.quark` earns its place for rich values and for `$name` reads across a subtree.
- DevTools shows a JS write as a binding change without a sheet.
