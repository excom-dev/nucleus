# super-input

A lightweight element that wraps and upgrades the native `<input>` element.

<include-content data-demo="comprehensive"></include-content>

## Features

- **Live text formatting** e.g. phone numbers, dates, SSNs
- **Custom, native validity messages** uses the browser's built-in validation UI to show your message
- **Auto-labeling** it stitches a sibling `<label>` to the `<input>` via `id`/`for`
- **Progressively enhanced** Does **not** replace the native input; it enhances it. Everything you know
about `<input>` still applies.
- **Range slider** ships with upgraded slider styling and functionality

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Wrap a native `<input>` and optionally a `<label>`. Nothing else is required. 

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Formatting input as the user types

Set `text-format` to a template using `x` as a character placeholder.

<include-content data-demo="with-format"></include-content>

Common templates:

- Phone (US): `(xxx) xxx-xxxx`
- Date: `xx/xx/xxxx`
- SSN: `xxx-xx-xxxx`

The wrapped `<input>` sees the formatted value. Pair with `pattern` for
validation.

#### Custom validity messages

Set `invalid-message` and the browser's native validation UI will surface it
when the input fails. Use the native `pattern`, `required`, `min`, `max`, etc for validation.
Try submitting the form in the demo below with an invalid phone number.

<include-content data-demo="invalid-message"></include-content>

The message is installed via `setCustomValidity()` on the `invalid` event and
cleared on the next `keydown`, so the input stops being marked invalid as
soon as the user tries again.

#### Using reflect-value
The `reflect-value` attribute has two primary uses:
- Is required for animating `raised` labels without an input `placeholder` attribute
- Allows you to hook into it to run your own behaviors

Here's an example with a raising label that will display an error if the user has not entered an email with an `@` or `.` characters.

<include-content data-demo="reflect-value"></include-content>

#### Range slider
`<super-input>` ships with advanced slider CSS. Add `[type="range"]` to the `input`. `[reflect-value]` is required for this to work natively in Chromium browsers. Safari and Firefox will need some help via Quark or JS until they support [the CSS `type()` function](https://caniuse.com/mdn-css_types_type). You must also set the min/max CSS variables to match the min/max on the input.

Be cautious using this feature, as it aesthetically relies on non-standard pseudo elements for the time being.

<include-content data-demo="slider"></include-content>
