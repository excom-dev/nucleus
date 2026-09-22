# Using Nucleus Kit Elements

Every Nucleus Kit element obeys the same contract: it is an [Adapter](/nucleus/docs/adapter_state_orchestrator), bridging one protocol and the document. Learn that contract once and any package page becomes readable in a minute.

## The contract

**Attributes in.** Options are attributes. Booleans are presence attributes. Names always contain a dash, so they never collide with native attributes.

```html
<include-content lazy-load template-ref="/views/profile.html"></include-content>
```

**Attributes out.** Primitive lifecycle and status appear as *state* attributes: `is-loading`, `is-success`, `is-error`, `is-active`, `has-rendered`, `did-fail`. Those are the attributes CSS and Quark select on.

```css
provider-fetch[is-loading] { opacity: 0.5; }
```

**Events out.** Custom events carry the tag name as a prefix (`super-form-success`, `spa-route-render`) so they never shadow native ones. Most bubble, which means a single listener higher in the tree can hear an entire subtree.

**Data out.** Providers — and a few others — publish a rich payload as a *provision*: the parsed response, route params, a geolocation reading. Quark reads it with `prop("provision")`:

```quark
provider-fetch[is-success] { $user: prop("provision").body; }
```

**Default actions.** Some events are cancelable. Call `preventDefault()` from a handler and the element skips whatever it would have done next. That is the escape hatch for the uncommon "almost, but not quite" case.

**Recognized elements.** Elements never invent opinionated children; they may recognize the children *you* write. `super-form` expects your `<form>`. `content-tabs` expects your `content-tabs-header` and `content-tabs-body`. Package pages list exactly what each element looks for.

## Reading a package page

| Section | What it tells you |
| --- | --- |
| Subtitle + demo | The one job, shown in the fewest possible lines |
| Features | The use cases it covers, in plain terms |
| Attributes | `option` (you set it) vs `state` (the element sets it), types, defaults, allowed values |
| Fires / Listens for | Every event, when it fires, and the shape of `event.detail` |
| Default actions | What `preventDefault()` will skip |
| Recognized elements | The descendants it wires up automatically |
| CSS | Classes, variables, and aliases you can hook into or opt-out of |

## Naming tells you the shape

Nucleus Kit elements follow the recommended naming conventions.

| Prefix | Meaning | Examples |
| --- | --- | --- |
| `super-*` | Wraps and upgrades a native element you still write yourself | `super-form`, `super-input` |
| `content-*` | Expects children and manages their presentation | `content-tabs`, `content-drawer`, `content-carousel` |
| `provider-*` | Publishes data for the page to consume | `provider-fetch`, `provider-geolocation`, `provider-orientation` |
| `spa-*` | Routing and navigation | `spa-manager`, `spa-route`, `spa-a` |
| `detect-*` | Reflects the environment as selectable attributes | `detect-browser`, `detect-features`, `detect-media` |

**Families.** Some jobs need a small group of tags that only make sense together (`content-tabs` + `content-tabs-header` + `content-tabs-body`, `spa-manager` + `spa-route`). The parent coordinates its own family — that is expected, and it is the one place an element manages something other than itself. Families share a name prefix so the relationship is visible in markup.

## The catalog

**Layout** — `content-carousel`, `content-drawer`, `content-tabs`, `dialog-anchor`, `dismiss-watcher`, `data-table`

**Content / routing** — `include-content`, `spa-route` (with `spa-manager`, `spa-a`), `scroll-into-view`

**Forms / auth** — `super-form`, `super-input`, `web-authn`

**Providers** — `provider-fetch`, `provider-geolocation`, `provider-orientation`, `provider-storage`

**Platform** — `detect-browser`, `detect-features`, `detect-media`, `dom-observer`, `event-handler`, `network-status`, `service-worker`

**Orchestration** — `quark-sheet`

The sidebar lists every package with its current API. `nucleus-kit` installs the whole catalog at once; each package also installs alone — if you end up using only a few elements, install those packages à la carte and skip the bundle.

## Three you'll use constantly

**`include-content`** renders a view when and where you need it — lazily on scroll, on idle, on an event, or immediately — from a `<template>` or a URL. It is the unit of composition for views. See [Building Views](/nucleus/docs/building_views).

**`provider-fetch`** turns a URL into a provision. Set `api-url`, read `prop("provision")` in Quark, react to `is-loading` / `is-success` / `is-error`. Pair it with `is-paused` to hold a request until the page is ready.

**`event-handler`** stitches behavior together: turn any event into a custom event or a command aimed at any element (`target-ref`), listen globally for keyboard shortcuts, or debounce input. Most "glue" that would otherwise be a click handler becomes one of these tags — or, where a sheet is already present, an `@on` block with `@dispatch` / `@command` (see [Orchestrating](/nucleus/docs/orchestrating)). Often no tag is needed at all: elements accept their imperatives as native commands, so a plain `<button command="--toggle" commandfor="menu">` drives a drawer with nothing in between.

```html
<button type="button" command="--toggle" commandfor="menu">Menu</button>
<content-drawer id="menu" class="absolute">
  <nav>…</nav>
</content-drawer>
<event-handler class="tag-backdrop" role="presentation" target-ref="content-drawer:has(+ :scope)" command-name="--close"></event-handler>
```

Every command an element accepts (`--fetch`, `--submit`, `--reload`, `--open`) is listed on its package page under *Commands*. A `<button>` reaches its target by id; `<event-handler command-name>` reaches it by selector and can relay any event (`listen-for="super-form-success"`).

## Native elements are Adapters too

`<details>`, `<dialog>`, `<form>`, `<input>`, and `<select>` already bridge a protocol — disclosure, the top layer, submission, the keyboard — carrying its state as attributes and firing events. Prefer their native state before inventing your own:

```quark
details[open] #status { content: "Open"; }
details:not([open]) #status { content: "Closed"; }
```

The Nucleus Kit catalog exists to give the *same* contract to protocols the platform does not cover yet — not to replace what it already does.

## Two habits worth forming

- **Select on state, not on classes.** Setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance. Keep classes for static styling.
- **Set attributes, not properties, before upgrade.** If script runs before an element's definition has loaded, `setAttribute()` is honored on upgrade; a property assignment is not.
