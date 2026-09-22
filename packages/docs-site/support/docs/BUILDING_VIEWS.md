# Building Views

The Nucleus Stack has no components. When you need a reusable piece of UI with its own behavior, you write a **view**: an HTML fragment that owns its scoped CSS and Quark sheets. A JS Module is optional. Views are composed by the elements that load them.

## Anatomy of a view

```
views/
  profile/
    profile.html    # markup: one root element, bind-* targets, <template>s
    profile.css     # styles scoped to the root
    profile.quark   # orchestration scoped to the root
    profile.js      # custom logic functions, called from Quark.
```

```html
<section id="profile">
  <link rel="stylesheet" href="/views/profile/profile.css">
  <quark-sheet src-url="/views/profile/profile.quark"></quark-sheet>

  <provider-fetch api-url="/api/me">
    <h2 bind-name></h2>
    <ul bind-roles>
      <template><li></li></template>
    </ul>
  </provider-fetch>
</section>
```

```quark
@use "/views/profile/profile.js" as profile-module;

/* profile.quark — host is #profile */
provider-fetch[is-success] {
  $me: prop("provision").body;
  [bind-name] { content: profile-module.formatName($me.name); }
  [bind-roles] { content: iterate($me.roles); }
  [bind-roles] li { content: item; }
}
```

Two rules keep views portable:

1. **One root element.** That root is the sheet's host, so rules cannot leak and the view can be dropped anywhere.
2. **Re-derive your own context, if necessary.** Like CSS variables, Quark variables also cascade. If the parent view defines the desired variable, use it. If not, define it on the ancestor. You will need to use `<quark-sheet is-global>`.

## Loading views

### `include-content`

The workhorse. It renders a `<template>` or a remote fragment when and where you want it.

```html
<include-content lazy-load template-ref="/views/comments/comments.html"></include-content>
<include-content is-active template-ref="#empty-state"></include-content>
<include-content idle-load pre-fetch="idle" template-ref="/views/settings/settings.html"></include-content>
<include-content is-active><template>Recognized by default.</template></include-content>
```

- **Lazy (un)load** — render once scrolled into view, and optionally unrender once it leaves. `observer-root-margin` lets you start early.
- **Eager / idle** — render immediately (`is-active`), or when the browser is idle (`idle-load`).
- **Conditional** — toggle `is-active` from Quark to show or hide.
- **Prefetch** — `pre-fetch="idle"` warms a remote template so activation is instant.
- **Keep state** — `persist-content` reuses the same tree across toggles instead of rebuilding.

Because `is-active` is just an attribute, conditional rendering is a Quark rule:

```quark
main[data-mode="edit"] include-content[bind-editor] { is-active: ""; }
main:not([data-mode="edit"]) include-content[bind-editor] { is-active: none; }
```

### `spa-route`

Routing is a set of tags. Each `spa-route` matches a URL pattern and renders a view; `spa-manager` (which is optional) batches changes into view transitions; `spa-a` navigates.

```html
<spa-manager>
  <spa-route route-href="/" template-ref="/views/home/home.html"></spa-route>
  <spa-route route-href="/users/:id" template-ref="/views/user/user.html"></spa-route>
  <spa-route route-regex=".*" template-ref="/views/not-found/not-found.html" is-fallback></spa-route>
</spa-manager>

<nav>
  <spa-a route-href="/">Home</spa-a>
  <spa-a route-href="/users/42">Me</spa-a>
</nav>
```

Route params are a provision.

```quark
spa-route[is-active] {
  $params: prop("provision").params;

  &[template-ref$="user.html"] provider-fetch {
    api-url: "/api/users/#{$params.id}";
  }
}
```

Nested layouts (`match-nested`), scroll restoration, history actions, and per-direction transition styling are all attributes on these tags. See the [spa-route](/nucleus/packages/spa-route) package for the full set.

## An app skeleton

```html
<body>
  <quark-sheet src-url="/shell.quark"></quark-sheet>

  <include-content is-active template-ref="/views/header/header.html"></include-content>

  <spa-manager>
    <spa-route route-href="/" template-ref="/views/home/home.html"></spa-route>
    <spa-route route-href="/settings" template-ref="/views/settings/settings.html"></spa-route>
  </spa-manager>
</body>
```

```
/index.html
/shell.quark          # site-wide rules (theme, auth state, global shortcuts)
/shell.js             # optional pure functions any sheet may @use. Simple applications may prefer to keep all functions in this single file.
/shell.css            # shared layout
/views/<name>/<name>.{html,css,quark}
```

No build process is required. Files are served as-is, views load on demand, and editing any file is a refresh away.

## Data between views

Nested view communication and shared data is done the same way everything else is:

- **Down** through the document: a parent sets an attribute or publishes a provision; a descendant view reads it.
- **Up** through events: a view's element fires (or a sheet's `@on` block `@dispatch`es); an ancestor's sheet or `event-handler` listens. Events bubble, so a single rule at the root can hear the whole app.
- **Across** through shared state / Quark variable on a common ancestor.

When two views need the same value, put it on their nearest common ancestor and let both read it. Do not reach for JavaScript to pass it around.

Name every custom attribute with a dash (`data-duration`, `is-open`), never a bare word (`duration`): a bare name can shadow, or later collide with, a native attribute. Form field names follow the same rule when an `@on input` block copies them onto the host (`data-trip: event.target.form.elements["data-trip"].value`).

## Long lists

`iterate()` keeps the DOM proportional to your data. For heavy rows, stamp a lightweight `<include-content lazy-load>` per item and put the expensive markup in a commonly referenced template; only rows on screen materialize, and they can unrender as they scroll away (via the `lazy-unload` attr). This will ensure linear performance: only a single node per iteration. That covers most lists comfortably. At six figures of rows, node count itself becomes the limit — see [Limitations](/nucleus/docs/limitations).

## Enhancing existing static pages

Everything above works on a server-rendered or CMS page. Start with one element and one sheet inside one section. The rest of the page is unaffected, and there is no rewrite waiting at the end.

## Load order

Put `<quark-sheet>` first inside its host so it registers before sibling elements connect. Prefer reacting to state attributes (`is-success`, `is-active`) over one-shot events for anything that can happen during boot. See [Orchestrating](/nucleus/docs/orchestrating).
