# detect-features

Feature detection — gate content on real browser support with
plain CSS.

<include-content data-demo="simple"></include-content>

## Features

- **Support tokens** Set once on connect for CSS / Quark targeting
- **CSS-selectable** Gate content with attribute selectors, no polyfills
- **JS / Quark data** `.provision` exposes `fullSupport` / `noSupport` arrays
- **Common Web APIs** Geolocation, share, bluetooth, clipboard,
  media-devices, service-worker, payment-request, and many more

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Check `full-support` / `no-support` for a space-separated feature name.

```html
<detect-features></detect-features>
```

Use CSS or Quark to react to the feature detection:

```css
detect-features:not([full-support~="geolocation"]) ~ .needs-location {
  display: none;
}
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Gate a whole section

`full-support` lists every feature this browser supports; `no-support`
lists the rest. Wrap a whole section instead of one element by pairing
`:has()` with the same attribute selector:

```css
body:has(detect-features:not([full-support~="geolocation"])) #store-locator {
  display: none;
}
```

#### Web Share progressive UI

Show a share affordance only when `share` is listed in `full-support`.
Browsers without Web Share keep the fallback copy instead.

<include-content data-demo="share"></include-content>
