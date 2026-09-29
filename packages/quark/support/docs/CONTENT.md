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
pre {
  content: dangerous-html(highlight($snippet));
}
```

A module function may also return a `Node` / `NodeList` — the same paint path as `template()` / `iterate()`. That is how a third-party renderer reaches the page: the function creates its own element with `document.createElement()`, renders into it and returns it.

```quark
@use "/charts.js" as *;

provider-fetch[is-success] {
  $series: prop("provision").body;
  [bind-chart] { content: createChart($series); }
}
```

A source `<template>` child is kept, and writing into a `<template>` targets its `.content`. `content:` does not await: a promise from a module function is refused with `Quark: content does not await a promise from a module function — return a value or a node`, and the content is left untouched. A function whose work finishes later returns its element at once and fills it afterwards — see [Asynchronous work](./USE.md#md-asynchronous-work).

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
