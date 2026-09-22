# @delay

`@delay <ms> { … }` applies a block once, after a pause — a "Copied!" flash, a toast that hides itself, an undo window — with no timer in JS.

## Writing a delay

```quark
button[data-copy] {
  @on click {
    data-copied: "";
    @delay 2000 { data-copied: none; }   /* rapid clicks restart it */
  }
}
output[is-visible] { @delay 4000 { is-visible: none; } }
todo-item[is-pending-delete] {
  @on click (target: "[data-undo]") { is-pending-delete: none; }
  @delay 5000 { is-deleted: ""; }         /* dropped if undo clears the gate first */
}
[data-flash] { @delay +attr("data-flash-ms") or 1500 { data-flash: none; } }
```

The duration is any expression — a literal, a binding, an `attr()` read, arithmetic, a `quark:math` call — in milliseconds. The block is an ordinary rule body: declarations write the matched element, nested rules write its matching descendants, and it may hold another `@delay` or a `@view-transition`. `@on` inside the block is not supported.

## When it fires

- The timer starts when the rule applies to the element, or when the event fires inside an `@on` block, and **restarts on every application** — one timer per element. A rule re-applies when its selector's dependencies change, so a rule that fans out on unrelated attribute changes restarts its delays too.
- When the timer fires, the block applies **only if the element is still in the document and the rule still matches**; otherwise it is dropped. That is what makes the undo idiom above safe: clearing the gate cancels the pending write.
- Inside an `@on` block, `event` and `target` keep the values the block was scheduled with.
- Pending timers are cleared when the sheet unregisters.

## Safety

The block keeps the [loop guard](./LOOP_GUARD.md)'s causal depth of the run that scheduled it, so two delays that keep re-triggering each other are cut like any other runaway chain instead of ticking forever.

Time is otherwise an Adapter's protocol: `@delay` is for a wait that belongs to one State change, not for clocks, polling or animation — those are elements (`<timer-…>`) and CSS.

DevTools sees every timer as a `["quark", "delay"]` publication: `scheduled` (with `ms`), `fired`, or `dropped` (with `reason`: `"disconnected"`, `"unregistered"`, `"unmatched"`) — see [JS API](./JS_API.md).
