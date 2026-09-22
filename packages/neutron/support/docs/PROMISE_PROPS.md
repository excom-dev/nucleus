# Promise props

Store a promise in a prop and react to its settlement; replacing it cancels the stale one.

## Resolve / reject handlers

```ts
Neutron({
  tag: "lazy-item",
  props: {
    srcPromise: Promise,
    provision: Object,
  },
})
  .onConnected(() => ({
    srcPromise: fetch("/api/item").then((r) => r.json()),
  }))
  .onPromiseResolved("srcPromise", (_el, result) => ({
    srcPromise: null,
    provision: result.srcPromise,
  }))
  .onPromiseRejected("srcPromise", () => ({ srcPromise: null }));
```

`result` maps the prop name to the resolved value (or the rejection reason).

## Cancellation

Assigning a new promise or `null` while the previous one is pending cancels it — the stale settlement never reaches the handlers.
