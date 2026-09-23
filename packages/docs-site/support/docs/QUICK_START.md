# Quick Start

One HTML file is enough. No install, no build, no framework.

What follows is our [Todo App example](/nucleus/examples/todos), verbatim, with one deliberate change — it reads from the public [JSONPlaceholder](https://jsonplaceholder.typicode.com) API and sorts through a JS function. Open the example to edit any of it live.

## 1. Load Nucleus Kit

`nucleus-kit` packages the elements, Quark, and Valence.css behind a single import.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My first Nucleus app</title>
    <link rel="stylesheet" href="https://unpkg.com/@excom/nucleus-kit/dist/basic.min.css">
    <script src="https://unpkg.com/@excom/nucleus-kit/dist/index.umd.min.js"></script>
  </head>
  <body>
    <main></main>
  </body>
</html>
```

Want a package manager instead? `npm install @excom/nucleus-kit`, then `import "@excom/nucleus-kit"` and `@import "@excom/nucleus-kit/basic.css"`. Every element is also published independently — any package page covers the slim install.

## 2. The markup

Drop this `<article>` into the `<main>`, and save the three files beside it. It is the whole app: a provider that fetches, a `<template>` describing one row, and a form per action. No ids, no classes, nothing dynamic — every fact arrives later, as an attribute.

```html
<article>
  <link rel="stylesheet" href="/todo-app.css">
  <quark-sheet src-url="/todo-app.quark"></quark-sheet>
  <provider-fetch api-url="https://jsonplaceholder.typicode.com/todos?_limit=5">
    <ul>
      <template>
        <li>
          <super-form>
            <form method="patch">
              <input type="checkbox" name="completed">
              <input name="title" required autocomplete="off">
            </form>
          </super-form>
          <super-form>
            <form method="delete">
              <button type="submit"></button>
            </form>
          </super-form>
        </li>
      </template>
    </ul>
    <super-form>
      <form action="https://jsonplaceholder.typicode.com/todos" method="post">
        <input name="title" required autocomplete="off" placeholder="New Reminder">
        <button type="submit"></button>
      </form>
    </super-form>
  </provider-fetch>
</article>
```

[`provider-fetch`](/nucleus/packages/provider-fetch) does the reading and publishes the response for the sheet to pick up. [`super-form`](/nucleus/packages/super-form) wraps a `<form>` you write yourself and submits it over `fetch`, so `method="patch"` and `method="delete"` work where the browser only offers GET and POST.

JSONPlaceholder returns `{ userId, id, title, completed }` — the same field names the example already binds, so `title` and `completed` are untouched. Only the URLs changed: `/api/todos` became the JSONPlaceholder URL, and `?_limit=5` keeps the list to five rows.

## 3. The rules

A `<quark-sheet>` observes its parent and applies rules to everything inside it. Read it like CSS: *when the provider succeeds, take its body, stamp one `<li>` per todo, and fill each row from the item.*

```quark
@use "./utils.js" as utils;

provider-fetch[is-success] {
  $todos: prop("provision").body;
  ul {
    content: iterate(utils.mySort($todos), none, "id");
    form {
      action: "https://jsonplaceholder.typicode.com/todos/#{item.id}";
    }
  }
  input[name="completed"] {
    checked: item.completed;
  }
  input[name="title"] {
    value: item.title or "";
  }
  super-form:has([name="completed"]) {
    /* Submits form when inputs change. Uses native Command. */
    @on change { @command --submit; }
  }
  /* Re-fetches todos after successful form submission. */
  @on super-form-success { @command --fetch; }
}
```

Nine declarations carry the entire app. `iterate()` is keyed on `"id"`, so a re-read reuses the rows it already has. Every row's `action` is written from its own item, which is why one `<template>` serves every todo. The two `@on` blocks close the loop: a changed field submits its form, and any form that succeeds tells the provider to read the list again.

### Calling out to JS

The one deviation from the example app is `utils.mySort($todos)`. It is contrived — Quark could render the array as it arrives — but it shows the boundary exactly.

```js
export const mySort = (todos) => [...todos].sort((a, b) => a.title.localeCompare(b.title));
```

`@use "./utils.js" as utils;` loads the module beside the sheet and namespaces its exports under `utils`. The function is pure: it receives the data as an argument, returns a sorted array for Quark to render, and has no idea a document exists. It never queries the DOM and never writes to it — that is the Orchestrator's job, and Quark is already doing it. [Business Logic](/nucleus/docs/business_logic) covers where that line sits and why calculations belong on this side of it.

## 4. The styling

Trimmed to what you need to see it work — the [example](/nucleus/examples/todos) carries the full file. The first two rules are the interesting ones: CSS selects on the same facts Quark writes, so an error message and a struck-through title need no extra state.

```css
@scope {
  /* data-driven css */
  provider-fetch[is-error] ul::before {
    display: block;
    padding: 0.6rem 1rem;
    color: var(--v-del-color);
    font-size: 0.875rem;
    content: "Could not load todos.";
  }
  li:has(:checked) input[name="title"] {
    color: var(--v-muted-color);
    text-decoration: line-through;
  }

  /* add cosmetic styling here */
}
```

## 5. What you will see

JSONPlaceholder **fakes every write**. A POST, PATCH or DELETE answers as if it worked — POST returns the new todo with `id: 201`, PATCH echoes the merged object, DELETE returns `{}` — but nothing is stored. Since this app re-reads the list after every successful write, the server's unchanged answer wins:

- **Check-off a todo** and it PATCHes, re-reads, and snaps back to whatever JSONPlaceholder still says.
- **Add a todo** and it POSTs, re-reads, and the new row disappears.
- **Delete a todo** and it DELETEs, re-reads, and the row returns.

That is the API being honest about being a fixture, not the app being broken. Point `api-url` and the two `action` URLs at a real endpoint and every one of those actions sticks, with no other change.

## What to try

- Tick a todo, then watch the network panel: one PATCH, one GET, and the row restored.
- Add "Write tests" and watch it vanish on the re-read.
- Reverse the sort in `utils.js` — the rows reorder without re-fetching, because `iterate()` is keyed on `id`.
- Drop `?_limit=5` to render all 200 rows, and note that nothing else has to change.

## What just happened

- **Elements** owned their own behavior and reported state through attributes such as `is-success`.
- **The document** held every fact the app knows.
- **Quark** observed that state and cascadingly updated it in response.

That loop is the entire architecture. [Core Concepts](/nucleus/docs/core_concepts) walks through it in one sitting.

## Next steps

- [Using Elements](/nucleus/docs/using_elements) — the Nucleus Kit catalog and how every element behaves.
- [Orchestrating](/nucleus/docs/orchestrating) — everything Quark can do.
- [Building Views](/nucleus/docs/building_views) — structure a real app: routes, views, lazy loading.
- [Styling](/nucleus/docs/styling) — Valence.css themes, tokens, and state-driven CSS.
