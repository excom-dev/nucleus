# provider-orientation

Declarative device orientation / compass — request a heading, read the
normalized bearing from attributes/state.

## Features

- **Attribute-driven** Request + read a compass heading through attributes
- **Normalized bearing** `0`–`360°` from magnetic north on both iOS and
  Android, one shape either way
- **Throttled updates** `compass-throttle-ms` caps update frequency
  (Android can fire 60-200 Hz)
- **iOS-aware** Works with the required user-gesture permission flow

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

**Requires a user gesture on iOS.** `DeviceOrientationEvent
.requestPermission()` must run synchronously inside a click handler or
Safari denies it — so set `is-paused` and invoke the `--request` command
from a button rather than relying on the connect-time auto-request (the
handler runs in a microtask of the click, inside its user activation):

```html
<button type="button" command="--request" commandfor="compass">
  Enable compass
</button>
<provider-orientation id="compass" is-paused></provider-orientation>
```

```css
compass-needle {
  transform: rotate(calc(var(--bearing, 0) * 1deg));
}
```

Android and desktop browsers with a sensor don't require permission and
will start listening as soon as the request fires; browsers with no
sensor at all simply never report a reading.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Request on click

<include-content data-demo="request"></include-content>
