It is advised this element's behaviors are put behind click events, not on connected, since it's not recommended to annoy the user with permission popups without the user interacting first.

```html
<dialog>
    To use the full functionality of the app, we would like to use your location.
    <button>No</button>
    <permission-request for-api="geolocation">Okay!</permission-request>
</dialog>

<dialog>
    We would like to send you push notifications.
    <button>No thanks!</button>
    <permission-request for-api="pushnotifications">Sure!</permission-request>
</dialog>
```