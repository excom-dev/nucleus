# provider-fetch

Fetch data with HTML. Pair it with Quark to render the data. Zero app JS.

<include-content data-demo="simple"></include-content>

## Features

- **Provides data** Use Quark to render that data
- **Auto-fetch** Fetches whenever `api-url` is set or changes
- **Re-fetch on demand** The `--fetch` command (`<button command="--fetch" commandfor="…">`) forces a re-fetch
- **Pausable** `is-paused` holds off auto-fetch without removing state
- **Highly configurable** Headers, method, `form-ref`,
  credentials, redirect, etc

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

```html
<provider-fetch api-url="/api/todos"></provider-fetch>
```

Hook the lifecycle state with CSS:

```css
provider-fetch[is-loading] { /* show loading spinner */ }
provider-fetch[is-error]::before { content: "An error occurred." }
```

Or Quark:

```quark
provider-fetch[is-success] {
  $todo: prop("provision").body;
  span { content: $todo.title; }
}
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Comprehensive

This example shows loading state, error state, rendering, and refetching.

<include-content data-demo="refetch"></include-content>
