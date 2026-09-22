# Content

`content:` replaces an element's rendered children — text, a template clone, one row per item, or raw HTML.

## Text, templates, HTML

```quark
article {
  content: template("#article-tmpl"); /* or template("/views/a.html") */
}
details:not([open]) p {
  content: none;
}
header {
  content: dangerous-html(getHeaderHtml());
}
```

A JS callout may also return a `Node` / `NodeList` — same paint path as `template()` / `iterate()`. A source `<template>` child is kept; writing into a `<template>` targets its `.content`; a promise is awaited.

A text result painted into a `<textarea>` is also mirrored to its live `.value` (the text is only the default value; see [Attributes](./ATTRIBUTES.md#md-form-controls)).

## Iterations

`iterate(array)` renders one copy of the element's `<template>` per item:

<include-content data-demo="iterate"></include-content>

`item` / `index` are available to matching rules for each row. Objects iterate as key → `index`, value → `item`. Pass a key property (`iterate($todos, none, "id")`) so existing rows are reused when the collection changes.

## Pitfall

Do not render a template that re-matches the same rule — the loop guard cuts it after 50 nested paints, but the fix is the selector:

```quark
/* BAD — each new span matches again */
span {
  content: template("#span-template");
}
```
