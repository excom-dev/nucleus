# @view-transition

`@view-transition [(options)] { … }` commits the writes inside it inside `document.startViewTransition()`, so CSS can animate what changed — rows that leave included, which plain CSS transitions cannot reach.

## A paint policy

The block decides *how* its declarations and its nested rules' writes land, never *when* rules run.

```quark
provider-fetch[is-success] {
  $todos: prop("provision").body;
  @view-transition (types: "todo-change") {
    ul { content: iterate($todos, none, "id"); }
    [bind-count] { content: $todos.length; }
  }
}
```

```css
ul { view-transition-name: todos; }
li { view-transition-name: match-element; view-transition-class: todo; }
::view-transition-new(.todo):only-child { animation: todo-in 250ms; }
::view-transition-old(.todo):only-child { animation: todo-out 200ms; }
:root:active-view-transition-type(todo-change) ::view-transition-old(root) { animation: none; }
```

<include-content data-demo="view-transition"></include-content>

- **One tick, one cut.** Every Quark write of the same tick lands in the same cut, and writes that react to those writes land in it too as long as Quark settles within `timeout`. Writes more than a tick later are a separate fact and a separate transition.
- **Put the writes of one cut inside the block** (the list, its counter, the empty state). Only a write inside a block starts a transition; writes outside it join the cut when they happen meanwhile. `$variables` do not paint, so a block holding only `$variable` writes never starts one.
- **Keyed `iterate()` rows persist**, so named rows move instead of leaving and entering again.
- **Styling is CSS's job.** Name elements (`view-transition-name`, `match-element`, `view-transition-class`) and target `::view-transition-group` / `-old` / `-new` and `:active-view-transition-type()`. While the animation runs, captured elements are drawn from those pseudo-elements, so real-DOM styles only show on elements that are not captured. A name that comes from State is one CSS variable away: `li { --vt-name: "row-#{item.id}"; }` in the sheet, `li { view-transition-name: var(--vt-name); }` in the CSS.
- **Options belong to the block.** They are evaluated per write, on the block's element — what the rule it sits in matches, or the host for a sheet-level block — so `attr()`, `prop()` and `item` read that element.

## Options

| Option | Effect |
| --- | --- |
| `types: "a b"` | Names for `:active-view-transition-type()`: a string (space-separated) or a list; `"todo-#{$op}"` interpolates. The types of every write in one transition are combined. |
| `timeout: <ms>` | How long the transition waits for Quark to settle before the new state is captured. Default 300, or 1000 with `until`. On expiry it captures what is there and warns once per block. |
| `delay: <ms>` | Hold these writes back first, then commit them in their own transition. Other writes of the same tick are not held and land first. |
| `first-render` | Also animate the sheet's first render (off by default, like `spa-manager`'s `transition-first-render`). |
| `if-active: skip` / `replace` | While another view transition runs (a route change, or Quark's own still animating): commit unanimated (`skip`, the default) or start anyway, which ends the running one (`replace`, the browser's own behavior). |
| `until: "<selector>"` / `until: <promise>` | Keep the transition open until the block's element matches the selector (`"[is-success], [is-error]"`, `":not([is-loading])"`, `":has(li)"`) or the promise settles, capped by `timeout`. |

## `until`

**`until` is for short waits.** The page stays frozen on the old state while the transition is open, so wait for a template or view that is about to render, never for a data fetch — animate a fetch as two cuts (`[is-loading]`, then `[is-success]`) instead. Put the block on the element that owns the fact and nest the writes; a block on a descendant waiting for an ancestor's attribute only times out:

```quark
provider-fetch[is-loading] {
  @view-transition (until: "[is-success], [is-error]", timeout: 800) {
    ul { content: none; }
  }
}
```

## When no transition runs

Committed without a transition: writes that change nothing, the sheet's first render, `prefers-reduced-motion: reduce`, a hidden document, browsers without the API (the writes land as usual) and, under `if-active: skip`, writes while another transition is active. A document runs one view transition at a time; scoped (per-element) transitions are not available yet.

## Costs

Each transition snapshots the page once, its writes land one rendering opportunity later than without the block, and pointer input goes to the transition overlay while it animates — keep animations short. It is the one place Quark stops being "write and forget": a State write waits for a rendering opportunity.
