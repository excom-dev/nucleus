# detect-browser

Drop-in tag provides browser, OS, device, and language metadata — target Safari, standalone mode, mobile devices, etc. Helpful in creating device-specific UX.

<include-content data-demo="simple"></include-content>

## Features

- **Attribute metadata** Set once on connect for CSS / Quark targeting
- **Standalone / PWA detection** `is-standalone` reflects installed mode
- **Language detection** `language-id` reflects system-selected language
- **Device class** `device-type` (`mobile` / `desktop`) for coarse targeting
- **Full metadata** `.provision` exposes user agent, languages, hardware hints

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Drop it anywhere and select on its attributes with plain CSS.

```html
<detect-browser></detect-browser>
```

```css
html:has(detect-browser[browser-name="safari"]) .safari-only {
  display: block;
}
```

Live touch / pointer detection is `detect-media media-query="(pointer: coarse)"` — this element reports what the user agent says once, not what the input is now.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Language

Showing a greeting in your system language (Only Spanish or English for this example). `language-id` mirrors `navigator.language` (lowercased). Spanish prefixes show `Hola`; everything else shows `Hello`. Change the browser language (or override it in DevTools) and reload to flip it.

<include-content data-demo="language"></include-content>

#### Loading platform-specific polyfills

In this demo, when the browser is Safari, polyfills are loaded. Spoof an iOS Safari user agent in DevTools and reload to trigger it. It will also `console.log` the full device info.

<include-content data-demo="safari"></include-content>
