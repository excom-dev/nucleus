# service-worker

Observes `navigator.serviceWorker` and optionally relays its events — zero app JS required.

<include-content data-demo="simple"></include-content>

## Features

- **Observation only** Reports on an existing Service Worker; never registers one
- **Support detection** `is-supported` reflects API availability
- **Ready state** `is-ready` reflects once an active worker controls the page
- **Event relay** `relay-events` forwards `message` / `messageerror` / `controllerchange` as plain DOM events
- **Bindable state** `.provision` is `{ isSupported, isReady, hasController, scope }` — kept current on connect, `ready`, and every `controllerchange`; read it from Quark with `prop("provision")`

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

This element only *observes* an already-registered Service Worker — it does not call `navigator.serviceWorker.register(...)` itself. Register your Service Worker separately (in app code, or your build tool), then drop this element anywhere to expose its state as attributes and, optionally, relay its events.

```html
<service-worker relay-events></service-worker>
<event-handler listen-for="message" fire-event="sw-message-received">
  ...
</event-handler>
```

Relayed events (`message`, `messageerror`, `controllerchange`) are dispatched with their original names — they are **not** prefixed with `service-worker-`.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Support / mount / ready state

`is-supported`, `is-mounted` (reflected by default), and `is-ready` are all plain attributes — style or branch on them with CSS. `is-ready` needs an app-registered Service Worker to ever resolve, so it will likely stay unset in this docs site.

<include-content data-demo="simple"></include-content>

#### Relay messages from your Service Worker

Relaying `message` / `messageerror` / `controllerchange` requires a Service Worker that your app has already registered and that is actively posting messages — this is not runnable in this docs site, but works like so once wired up:

```html
<service-worker relay-events="message"></service-worker>
<script>
  document
    .querySelector("service-worker")
    .addEventListener("message", (e) => console.log(e.detail));
</script>
```
