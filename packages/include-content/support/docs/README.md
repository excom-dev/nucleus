# include-content

One-stop shop for rendering a view when & where you need it — lazy-loading/unloading, conditional rendering, portalling… no app JS required.

<include-content data-demo="simple"></include-content>

## Features

- **Zero JS** Sophisticated UX from a simple HTML-only API, as with all Nucleus Kit elements.
- **Lazy (un)load** Lazy load and lazy unload your views
- **Eager / idle** Prioritize critical content; defer the rest
- **Prefetch** Warm templates so they're ready on activate
- **Shared / remote templates** Point at a DOM `<template>` or URL
- **Choose the host** Portal into light DOM, shadow, author iframe, or any selector
- **Keep state** Reuse the same tree across toggles
- **Animatable** Built-in fade, or bring your own with `.instant`

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Put a `<template>` inside (or set `template-ref`) and pick when it should appear. For conditional rendering, use Quark or JS to toggle `is-active`.

```html
<include-content lazy-load template-ref="/path/to/view.html"></include-content>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Template include

Break your app into smaller views. Point `template-ref` at a `<template>` or a URL with `is-active` to render it immediately. This demo does both.

<include-content data-demo="template-include"></include-content>

#### Lazy Load & Unload

`lazy-load` waits until on screen; `lazy-unload` removes it when it leaves. Give the host a real `min-height` so the trigger isn't ambiguous. Tune with `observer-root`, `observer-root-margin`, `observer-threshold`, and `observer-delay` — e.g. expand the margin to pre-render before the user scrolls to it. If remote template, pair with `pre-fetch="idle"` to warm the cache early.

<include-content data-demo="lazy"></include-content>

#### Portal elsewhere

By default content lands in the element's light DOM. Set `host-ref` to
`shadow`, `iframe` (with a child `<iframe data-render-host>`), or any CSS
selector to render somewhere else. The iframe host only moves nodes: custom
elements inside it upgrade only if that document loads their definitions.

<include-content data-demo="portal"></include-content>

#### Keep tree state

Toggling `is-active` off leaves `did-load` set (warm re-resolve; URL
refs hit the shared fetch cache). `persist-content` goes further and
reuses the same live nodes so implicit state (form values, open details,
etc.) survives toggles.

<include-content data-demo="persist-content"></include-content>