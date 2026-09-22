# spa-route

Build a full SPA from HTML alone — screens, links, and view transitions.

> This site is a live demo... inspect its HTML! Other live demos of spa-route coming soon.

```html
<spa-manager>
  <spa-route route-href="/" template-ref="/views/home.html"></spa-route>
  <spa-route route-href="/about" template-ref="/views/about.html"></spa-route>
</spa-manager>

<nav>
  <spa-a route-href="/">Home</spa-a>
  <spa-a route-href="/about">About</spa-a>
</nav>
```

## Features

- **Pure CSS View Transitions** Write CSS, get beautiful animations between routes
- **Active / was-active** Style current and outgoing links & screens (nav chrome, card expansion)
- **Same-route reuse / refresh** Keep or rebuild the view when only params change
- **Scroll reset / restore** Per-axis control for push, replace, back, forward
- **Nested layouts** Keep a parent route mounted under child paths
- **404 fallbacks** Catch-alls that only fire when nothing else matched
- **Per-route document title** `document.title` follows the active route
- **History actions** Push, replace, back, forward from a link

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Wrap screens in `<spa-manager>`, give each `<spa-route>` a `route-href`, and link with `<spa-a>`.

```html
<!-- Optional SPA manager for View Transitions and batched router config -->
<spa-manager>
  <!-- SPA routing -->
  <spa-route route-href="/" template-ref="/views/home.html"></spa-route>
  <spa-route route-href="/about" template-ref="/views/about.html"></spa-route>
</spa-manager>
<nav>
  <!-- SPA links -->
  <spa-a route-href="/">Home</spa-a>
  <spa-a route-href="/about">About</spa-a>
</nav>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Minimal SPA

Three routes, three links. Active links style via `spa-a[is-active]`.

```html
<spa-manager>
  <nav>
    <spa-a route-href="/home">Home</spa-a>
    <spa-a route-href="/users">Users</spa-a>
    <spa-a route-href="/about">About</spa-a>
    <spa-a route-href="/contact">Contact</spa-a>
  </nav>
  <spa-route route-href="/home">
    <template>
      <h3>Welcome</h3>
      <p>Mounted because the URL matched <code>/home</code>.</p>
    </template>
  </spa-route>
  <spa-route route-href="/users">
    <template>
      <h3>Users</h3>
      <ul>
        <li>Adam</li>
        <li>Linus</li>
        <li>Grace</li>
      </ul>
    </template>
  </spa-route>
  <spa-route route-href="/about" template-ref="/this/view/is/remote.html"></spa-route>
  <spa-route route-href="/contact" template-ref="#this-view-is-dom-selected"></spa-route>
</spa-manager>

<template id="this-view-is-dom-selected">foo@bar.com</template>
```

```css
spa-a[is-active] {
  font-weight: bold;
  pointer-events: none;
  text-decoration: none;
}
```

#### Nested layout & 404

`match-nested` keeps a layout mounted under child paths. `is-fallback` with `route-regex=".*"` is a 404 that only activates when no preceding sibling matched.

```html
<spa-manager>
  <nav>
    <spa-a route-href="/users">Users list</spa-a>
    <spa-a route-href="/users/42">User 42</spa-a>
    <spa-a route-href="/missing">Missing page</spa-a>
  </nav>
  <spa-route route-href="/users" match-nested>
    <template>
      <section>
        <h3>Users layout</h3>
        <spa-manager>
          <spa-route route-href="/users">
            <template><p>List of users.</p></template>
          </spa-route>
          <spa-route route-href="/users/:id">
            <template><p>Detail for a single user.</p></template>
          </spa-route>
        </spa-manager>
      </section>
    </template>
  </spa-route>
  <spa-route route-regex=".*?view=admin.*" template-ref="/views/admin-sidebar.html"></spa-route>
  <spa-route route-regex=".*" is-fallback>
    <template>
      <section>
        <h3>404</h3>
        <p>Catch-all — only when no preceding sibling matched.</p>
      </section>
    </template>
  </spa-route>
</spa-manager>
```

#### Document title

`document-title` sets `document.title` while its route is active. It keys off
activation, not clicks, so cold loads and back / forward retitle too. The
outermost `<spa-manager>` applies the last active route carrying one — a
nested route beats its ancestor — and restores the page's own `<title>` once
no active route has a title.

```html
<title>Nucleus · docs</title>

<spa-manager>
  <spa-route route-href="/" document-title="My company">
    <template><p>The company page.</p></template>
  </spa-route>
  <!-- untitled: the page's own <title> comes back -->
  <spa-route route-href="/docs">
    <template><p>The docs.</p></template>
  </spa-route>
</spa-manager>
```

#### History actions

`route-action="back"` / `"forward"` walk history; `"replace"` swaps the current entry instead of pushing.

```html
<spa-manager>
  <nav>
    <spa-a route-action="back">‹ Back</spa-a>
    <spa-a route-action="forward">Forward ›</spa-a>
    <spa-a route-href="/one">Push /one</spa-a>
    <spa-a route-href="/two">Push /two</spa-a>
    <spa-a route-href="/login" route-action="replace">
      Replace with /login
    </spa-a>
  </nav>
  <spa-route route-href="/one">
    <template><p>You're on <code>/one</code>.</p></template>
  </spa-route>
  <spa-route route-href="/two">
    <template><p>You're on <code>/two</code>.</p></template>
  </spa-route>
  <spa-route route-href="/login">
    <template>
      <p>You're on <code>/login</code> — this entry replaced the
        previous one in history.</p>
    </template>
  </spa-route>
</spa-manager>
```

#### View Transitions

`<spa-manager>` wraps each navigation in `document.startViewTransition()` (when supported). Style with `::view-transition-*`; set per-link types via `transition-types` (e.g. card expansion); opt a route out with `no-transition`.

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 0.25s;
}
```

#### View Transitions - Localized
If you had a list of cards, and clicking on one expanded it to the detail view (and vice versa, contracting), you would achieve it similarly to the code example below. This technique relies on styling the `<spa-a>` with its `[is-active]` (incoming view) and `[was-active]` (outgoing view).

```html
<spa-manager>
  <spa-route id="route-list" route-href="/list">
    <template>
      <spa-a route-href="/detail/123" transition-types="card-morph" class="mini-card">
        Go to detail
      </spa-a>
    </template>
  </spa-route>
  <spa-route id="route-detail" route-href="/detail/:id">
    <template>
      <article id="detail-card" class="card">
        <!-- other content here -->
      </article>
    </template>
  </spa-route>
</spa-manager>
```

```css
html:active-view-transition-type(card-morph) {
  #route-list spa-a[transition-types="card-morph"][was-active], /* outgoing list card (forward) */
  #route-list spa-a[transition-types="card-morph"][is-active], /* incoming list card (back) */
  #detail-card /* detail card (forward & back) */ {
    contain: layout;
    height: fit-content;
    view-transition-name: card-morph;
  }
}
::view-transition-old(card-morph),
::view-transition-new(card-morph) {
  mix-blend-mode: normal;
  height: 100%;
  width: 100%;
  will-change: opacity;
  animation-fill-mode: both;
}
::view-transition-old(card-morph) {
  animation-name: fade-out 1s ease;
}
::view-transition-new(card-morph) {
  animation-name: fade-in 1s ease;
}
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
```

#### Touch edge-swipe
On touch devices, horizontal drags from within `overscroll-x-threshold` of an edge trigger back / forward. Use `"none"` to block overscroll without navigating. Useful for preventing native swipes in Safari, which visually break SPAs.

```html
<spa-manager overscroll-behavior-x="navigate"></spa-manager>
```


#### Scroll reset / restore

By default, `<spa-route>`:
- resets scroll to top-left on `push` / `replace`
- restores the saved scroll position on `back` / `forward`

Override per axis with `scroll-reset-y` / `scroll-reset-x` — space-separated moves that should reset to `0` (omitted moves restore instead):

```html
<!-- also reset Y when the user hits back -->
<spa-route
  route-href="/article/:id"
  scroll-reset-y="push replace back"
></spa-route>
```

Animate with `scroll-reset-behavior="smooth"`. Disable all scroll handling with `scroll-set-disabled`.

#### Same-route params

When the matched route stays the same but params change (e.g. `/users/1` → `/users/2`):

- `same-route="reuse"` (default) — keep the rendered tree, update route data, and let `<spa-manager>` run a View Transition
- `same-route="refresh"` — tear down and re-render the view

```html
<spa-route route-href="/users/:id" same-route="refresh">
  <template><!-- fresh tree per user id --></template>
</spa-route>

<spa-route
  route-href="/logs/:view"
  same-route="reuse"
  scroll-set-disabled
>
  <template><!-- preserve content + scroll across view tabs --></template>
</spa-route>
```

#### Transition delay

`transition-delay` on `<spa-manager>` waits N ms before starting the batched View Transition — useful when sibling routes need a beat to queue their render/unrender callbacks, or for last-second DOM work.

```html
<spa-manager transition-delay="50">
  <!-- routes -->
</spa-manager>
```

