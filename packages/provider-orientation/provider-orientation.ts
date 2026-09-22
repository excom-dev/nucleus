import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export type ProviderOrientationSuccess = {
  bearing: number;
  alpha: number | null;
};

export type ProviderOrientationError = string | Error;

export type ProviderOrientationSuccessEvent = TEvent & {
  type: "provider-orientation-success";
  detail: ProviderOrientationSuccess;
};

export type ProviderOrientationErrorEvent = TEvent & {
  type: "provider-orientation-error";
  detail: ProviderOrientationError;
};

/**
 * Wraps the device orientation / compass APIs — request a heading and
 * read updates from attributes/state, no app JS required. Requests on
 * connect unless `is-paused`, same as the other `provider-*` elements —
 * but on iOS that request must happen synchronously inside a user
 * gesture (`DeviceOrientationEvent.requestPermission()`), so a
 * connect-time request will silently fail there. **Set `is-paused` and
 * invoke the `--request` command from a button instead** unless you know
 * your app only targets Android/desktop (the handler runs in a microtask
 * of the click, inside its user activation).
 *
 * Bearing (`provision.bearing`) is normalized to degrees clockwise from
 * magnetic north (`0`–`360`) across both the iOS
 * (`webkitCompassHeading`) and Android/absolute (`alpha`) code paths, so
 * consumers don't need to branch on platform.
 *
 * Lifecycle: the `window` listener is tracked by Neutron — removed when
 * the element leaves the document, restored (and the request repeated
 * unless `is-paused`) when it is reconnected, and kept across a DOM move.
 * Removing the element while an iOS permission prompt is still open
 * abandons that request: nothing is attached when it settles, and a
 * later reconnect requests again.
 *
 * @fires provider-orientation-success - Dispatched on every compass
 *   update (throttled by `compass-throttle-ms`). `bearing` is
 *   normalized 0-360°; `alpha` is the raw
 *   `DeviceOrientationEvent.alpha` where available.
 * @type ProviderOrientationSuccessEvent
 * @fires provider-orientation-error - Dispatched when the permission
 *   request is denied, or fails for any other reason.
 * @type ProviderOrientationErrorEvent
 * @command --request - Requests permission (iOS) and starts listening for
 *   orientation updates. Invoke it from a button (`<button
 *   command="--request" commandfor="…">`) so the user activation is there.
 * @default-action provider-orientation-success - Stores `{ bearing,
 *   alpha }` in `provision` and sets `is-success` (clearing `is-requesting` /
 *   `is-error`).
 * @default-action provider-orientation-error - Stores the error in
 *   `provision` and sets `is-error` (clearing `is-requesting` /
 *   `is-success`).
 */
export const ProviderOrientation = Neutron({
  tag: "provider-orientation",
  props: {
    // options
    /**
     * @option
     * Skip requesting on connect. On iOS this is effectively required
     * (a connect-time request happens outside a user gesture and will
     * be denied) — pair with `provider-orientation-request` from a
     * click handler instead (see class docs).
     */
    isPaused: Boolean,
    /**
     * @option
     * Minimum ms between `provider-orientation-success` updates.
     * Android can fire `deviceorientationabsolute` at 60-200 Hz;
     * without throttling that floods listeners and CSS/Quark bindings.
     * @default 100
     */
    compassThrottleMs: {
      type: Number,
      defaultValue: () => 100,
    },
    // state
    /**
     * @state
     * iOS only: the permission request is pending (between
     * `provider-orientation-request` and the user's response).
     */
    isRequesting: Boolean,
    /**
     * @state
     * Listening for orientation updates (permission granted where
     * required). Stays set across updates.
     */
    isSuccess: Boolean,
    /**
     * @state
     * The permission request was denied, or listening failed to start.
     */
    isError: Boolean,
    /**
     * @provision
     * Latest reading: `{ bearing, alpha }` on success, or the error on
     * failure. Not reflected as an attribute.
     * @type ProviderOrientationSuccess
     */
    provision: Object as unknown as ConstructorType<any>,
    // private
    permissionPromise: Promise as unknown as ConstructorType<
      Promise<PermissionStatus>
    >,
    lastCompassUpdate: {
      type: Number,
      defaultValue: () => 0,
    },
  },
})
  .defineMethods({
    handleSuccess: (_, { bearing, alpha }) => ({
      // Emit success event for continuous updates
      emit: ["provider-orientation-success", { detail: { bearing, alpha } }],
    }),
    handleError: (_, error) => ({
      emit: ["provider-orientation-error", { detail: error }],
    }),
    makeRequest: () => {
      const DOE =
        typeof DeviceOrientationEvent !== "undefined"
          ? (DeviceOrientationEvent as any)
          : null;
      if (DOE && typeof DOE.requestPermission === "function") {
        // iOS: request permission (async) from a user-gesture context
        return {
          permissionPromise: DOE.requestPermission(),
          isRequesting: true,
        };
      }
      /* Android / desktop: no permission here. Attach synchronously so it
         stays in the user-gesture context; some Android browser / PWA
         combos silently block `deviceorientation` outside a gesture. */
      return {
        _attachCompassListener: [],
        isRequesting: false,
        isSuccess: true,
        isError: false,
      };
    },
    /**
     * Register the `window` orientation listener once, via Neutron's
     * tracked registry (`target: window`). Dropped on disconnect,
     * restored on reconnect, never added twice.
     */
    // @ts-ignore TODO fix defineMethods sibling references
    _attachCompassListener: ({ compassHandler }) => ({
      addListener: [
        "ondeviceorientationabsolute" in window
          ? "deviceorientationabsolute"
          : "deviceorientation",
        compassHandler,
        { capture: true, target: window },
      ],
    }),
    compassHandler: ({ compassThrottleMs, lastCompassUpdate }, e: any) => {
      // Throttle: Android fires `deviceorientationabsolute` at 60-200 Hz
      const now = Date.now();
      if (now - lastCompassUpdate < compassThrottleMs) return;

      let bearing: number | null = null;

      // iOS: `webkitCompassHeading` (degrees from magnetic north, 0-360)
      if (typeof e.webkitCompassHeading === "number") {
        bearing = e.webkitCompassHeading;
      } else if (typeof e.alpha === "number" && e.absolute) {
        // Android / absolute: `alpha` is degrees from north
        bearing = (360 - e.alpha) % 360;
      }

      if (bearing !== null) {
        return {
          lastCompassUpdate: now,
          handleSuccess: [{ bearing, alpha: e.alpha ?? undefined }],
        };
      }
    },
  })
  .onConnected(
    // A DOM move keeps the listener (Neutron restores it). Only a fresh
    // connect or a real reconnect requests again.
    ({ isPaused, isMoving }) =>
      !isPaused &&
      !isMoving && {
        makeRequest: [],
      }
  )
  .onPropUnset("isPaused", () => ({
    makeRequest: [],
  }))
  .onPromiseResolved("permissionPromise", (element, result) => {
    /* Removed while the permission prompt was open: no disconnect will
       clean up, so attach nothing. A later reconnect requests again via
       `onConnected`. */
    if (!element.isConnected) return;
    // @ts-ignore TODO fix onPromiseResolved types
    if (result?.permissionPromise === "granted") {
      return { _attachCompassListener: [] };
    }
    return { handleError: ["Device orientation permission denied"] };
  })
  .onPromiseRejected("permissionPromise", (_, err) => ({
    handleError: [err],
  }))
  .onCommand("--request", () => ({ makeRequest: [] }))
  .onEventDefault("provider-orientation-success", (_, { detail }) => ({
    provision: detail,
    isRequesting: false,
    isSuccess: true,
    isError: false,
  }))
  .onEventDefault("provider-orientation-error", (_, { detail }) => ({
    provision: detail,
    isRequesting: false,
    isSuccess: false,
    isError: true,
  }));
