# super-form

Submit AJAX requests with HTML forms. Pair it with Quark to render the response.

<include-content data-demo="simple"></include-content>

## Features

- **Makes AJAX requests** JSON payload is built from each input's `name` and `type` attributes
- **Progressively enhanced** Doesn't replace the native `form`; it enhances it. Everything you know about `form` and `input` still applies.
- **Provides data** Use Quark to render the response
- **Submit command** `--submit` submits programmatically (`<button command="--submit" commandfor="…">`)
- **Highly configurable** Headers, credentials, redirect, etc

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Just wrap a regular form. Form fields become a JSON payload via their `name`: dot-separated names nest, and a trailing `[]` collects same-named fields into an array. `input[type]` determines the type conversion.

```html
<super-form>
  <form action="/api/signup" method="post">
    <input name="isAvailable" type="checkbox"> <!-- -> { isAvailable: true } -->
    <input name="address.city" value="Anytown"> <!-- -> { address: { city: "Anytown" } } -->
    <input name="tags[]" value="smart">
    <input name="tags[]" value="kind"> <!-- -> { tags: ["smart", "kind"] } -->
    <button type="submit">Sign up</button>
  </form>
</super-form>
```

Hook the lifecycle state with CSS:

```css
super-form[is-loading] { /* form currently submitting, show loading spinner */ }
super-form[is-error]::before { content: "An error occurred." }
```

Or Quark:

```quark
super-form[is-success] {
  $res: prop("provision").body;
  span { content: $res.json.email; }
}
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Comprehensive

This example shows loading state, error state, rendering, and triggering from outside the form.

<include-content data-demo="external-trigger"></include-content>
