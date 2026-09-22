# provider-geolocation

Declarative Geolocation API — request a position, read the result from
attributes/state.

<include-content data-demo="request"></include-content>

## Features

- **Attribute-driven** Request + read a position through attributes
- **User-gesture requests** `is-paused` + the `--request` command
  so permission prompts follow a click
- **One-shot or watch** `watch-position` streams updates instead of a
  single read

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Requesting location on page load is poor UX (an unsolicited permission
prompt) — gate it behind a user gesture with `is-paused` and a trigger:

```html
<button type="button" command="--request" commandfor="geo">
  Share my location
</button>
<provider-geolocation id="geo" is-paused></provider-geolocation>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>
