import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export type GeoSuccess = {
  coords: {
    longitude: number;
    latitude: number;
    altitude?: number;
    accuracy?: number;
    altitudeAccuracy?: number;
    heading?: number;
    speed?: number;
    timestamp?: number;
  };
};

export type ProviderGeolocationSuccessEvent = TEvent & {
  type: "provider-geolocation-success";
  detail: GeoSuccess;
};

export type ProviderGeolocationErrorEvent = TEvent & {
  type: "provider-geolocation-error";
  detail: GeolocationPositionError;
};

/**
 * Wraps the Geolocation API as a declarative element — request the
 * user's position (once or continuously) and read the result from
 * attributes/state.
 *
 * Lifecycle: a `watch-position` watch is cleared when the element leaves
 * the document and started again on reconnect (unless `is-paused`); a
 * DOM move keeps the current watch / request. A one-shot request that
 * settles after the element was removed is dropped — no event, no state.
 *
 * @fires provider-geolocation-success - Dispatched on every successful
 *   position read (including each update while `watch-position` is
 *   set).
 * @type ProviderGeolocationSuccessEvent
 * @fires provider-geolocation-error - Dispatched when the request fails
 *   (permission denied, timeout, position unavailable, or a thrown
 *   error).
 * @type ProviderGeolocationErrorEvent
 * @command --request - (Re)requests the position on demand — the standard
 *   way to request from a button (`<button command="--request"
 *   commandfor="…">`) while `is-paused` is set, or to force a fresh read
 *   at any time.
 * @default-action provider-geolocation-success - Stores the result in
 *   `provision` and sets `is-success` (clearing `is-requesting` /
 *   `is-error`).
 * @default-action provider-geolocation-error - Stores the error in
 *   `provision` and sets `is-error` (clearing `is-requesting` /
 *   `is-success`).
 */
export const ProviderGeolocation = Neutron({
  tag: "provider-geolocation",
  props: {
    // options
    /**
     * @option
     * Skip making a request on connect. `provider-geolocation-request`
     * still works while paused.
     */
    isPaused: Boolean,
    /**
     * @option
     * Request the most accurate position available (more battery /
     * time cost).
     */
    highAccuracy: Boolean,
    /**
     * @option
     * Give up and fire `provider-geolocation-error` after this many ms.
     * @default Infinity
     */
    geoTimeout: {
      type: Number,
      defaultValue: () => Infinity,
    },
    /**
     * @option
     * Accept a cached position up to this many ms old instead of
     * requesting a fresh one. Ignored when `watch-position` is set
     * (always `0`, i.e. no caching).
     */
    maximumAge: Number,
    /**
     * @option
     * Keep requesting — `provider-geolocation-success` fires on every
     * position update instead of once. Uses
     * `navigator.geolocation.watchPosition` under the hood.
     */
    watchPosition: Boolean,
    // state
    /**
     * @state
     * A position request is currently pending.
     */
    isRequesting: Boolean,
    /**
     * @state
     * The most recent request resolved successfully. With
     * `watch-position`, stays set across updates.
     */
    isSuccess: Boolean,
    /**
     * @state
     * The most recent request failed. Fires with the `error` event.
     */
    isError: Boolean,
    /**
     * @provision
     * Latest result: the coords object on success, or the
     * `GeolocationPositionError` (or thrown error) on failure.
     * Not reflected as an attribute.
     * @type GeoSuccess
     */
    provision: Object as unknown as ConstructorType<
      GeoSuccess | GeolocationPositionError | Error
    >,
    // private
    existingWatchId: {
      type: Number,
      attr: false,
    },
  },
})
  .defineMethods({
    handlePosition: (element, location: GeolocationPosition) => {
      // Settled after disconnect: drop it, don't mutate a detached node.
      if (!element.isConnected) return;
      return {
        // Success for a continuous watch update
        emit: [
          "provider-geolocation-success",
          {
            detail: {
              coords: {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                altitude: location.coords.altitude ?? undefined,
                accuracy: location.coords.accuracy ?? undefined,
                altitudeAccuracy: location.coords.altitudeAccuracy ?? undefined,
                heading: location.coords.heading ?? undefined,
                speed: location.coords.speed ?? undefined,
                timestamp: location.timestamp,
              },
            },
          },
        ],
      };
    },
    handleError: (element, error: GeolocationPositionError) => {
      if (!element.isConnected) return;
      return {
        emit: ["provider-geolocation-error", { detail: error }],
      };
    },
    makeRequest: ({
      highAccuracy,
      geoTimeout,
      maximumAge,
      watchPosition,
      // @ts-ignore TODO defineMethods
      handlePosition,
      // @ts-ignore TODO defineMethods
      handleError,
    }) => {
      let newWatchId: number | void | null = null;
      try {
        newWatchId = navigator.geolocation[
          watchPosition ? "watchPosition" : "getCurrentPosition"
        ](handlePosition, handleError, {
          maximumAge: watchPosition ? 0 : (maximumAge ?? 60000),
          timeout: geoTimeout,
          enableHighAccuracy: highAccuracy ?? false,
        });
      } catch (e) {
        handleError(e);
      }
      return {
        existingWatchId: newWatchId ?? null,
        isRequesting: true,
      };
    },
  })
  .onConnected(
    // A DOM move keeps the current request / watch. Only a fresh connect
    // or a real reconnect requests again.
    ({ isPaused, isMoving }) =>
      !isPaused &&
      !isMoving && {
        makeRequest: [],
      }
  )
  .onPropUnset("isPaused", () => ({
    makeRequest: [],
  }))
  .onPropChanged("existingWatchId", (_, previous) => {
    if (typeof previous.existingWatchId === "number") {
      navigator.geolocation.clearWatch(previous.existingWatchId);
    }
  })
  .onCommand("--request", () => ({ makeRequest: [] }))
  .onEventDefault("provider-geolocation-success", (_, { detail }) => ({
    provision: detail,
    isRequesting: false,
    isSuccess: true,
    isError: false,
  }))
  .onEventDefault("provider-geolocation-error", (_, { detail }) => ({
    provision: detail,
    isRequesting: false,
    isSuccess: false,
    isError: true,
  }))
  .onDisconnected(({ isMoving }) => {
    if (isMoving) return;
    return {
      existingWatchId: null,
    };
  });
