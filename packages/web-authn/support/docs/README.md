# web-authn

Passkey register / authenticate with HTML. Pair it with Quark to render the result.

<include-content data-demo="register"></include-content> 

```html
<web-authn start-method="register" options-url="/api/registration-options" verify-url="/api/users">
    <form>
        <button type="submit">One click sign up!</button>
    </form>
</web-authn>
```

## Features

- **Provides data** Use Quark to render the verify response
- **Full ceremony** Fetches options, runs the browser's WebAuthn prompt, then verifies — one element
- **Register or authenticate** `start-method` picks the ceremony
- **Submit command** `--submit` starts the ceremony programmatically — for forms outside the DOM subtree, or buttons outside the `<form>`
- **Chainable** `web-authn-success` fires like any `{tag}-success` event — chain a redirect or next step
- **Highly configurable** Headers, credentials, redirect, etc

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

Depends on [`@simplewebauthn/browser`](https://simplewebauthn.dev/) for the actual WebAuthn calls (`startRegistration` / `startAuthentication`). You can use any server-side library to handle the WebAuthn requests, but it is recommended to use the counterpart library, [`@simplewebauthn/server`](https://simplewebauthn.dev/), since they seamlessly understand the same contract.

## Usage

```html
<web-authn options-url="/api/webauthn/register/options"
  verify-url="/api/webauthn/register/verify" start-method="register">
  <form>
    <input name="username" required>
    <button type="submit">Register passkey</button>
  </form>
</web-authn>
```

On submit: `options-url` is fetched for ceremony options, the browser's native passkey prompt runs (`@simplewebauthn/browser`), and the resulting credential is posted to `verify-url`. Use `start-method="authenticate"` for sign-in instead of registration.

Hook the lifecycle state with CSS:

```css
web-authn[is-loading] { /* show loading spinner */ }
web-authn[is-error]::before { content: "An error occurred." }
```

Or Quark:

```quark
web-authn[is-success] {
  $res: prop("provision").body;
  span { content: $res.verified; }
}
```

Chain a next step off success the same way you would for any `<super-form>` or `<provider-fetch>`:

```html
<event-handler listen-for="web-authn-success" fire-event="onboarding-step-complete">
  <web-authn options-url="/api/webauthn/register/options"
    verify-url="/api/webauthn/register/verify" start-method="register">
    <form><input name="username"><button type="submit">Register</button></form>
  </web-authn>
</event-handler>
```

### Examples

#### Authenticate

<include-content data-demo="authenticate"></include-content>

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>


