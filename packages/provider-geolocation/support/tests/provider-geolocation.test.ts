import { invokeCommand } from "@excom/neutron";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

const mockPosition = {
  coords: {
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy: 100,
    altitude: 50,
    altitudeAccuracy: 10,
    heading: 90,
    speed: 5,
  },
  timestamp: 1700000000000,
};

const expectedData = {
  coords: {
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy: 100,
    altitude: 50,
    altitudeAccuracy: 10,
    heading: 90,
    speed: 5,
    timestamp: 1700000000000,
  },
};

const mockGeoError = {
  code: 1,
  message: "User denied Geolocation",
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
};

describe("provider-geolocation", () => {
  let geo: {
    getCurrentPosition: ReturnType<typeof vi.fn>;
    watchPosition: ReturnType<typeof vi.fn>;
    clearWatch: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    geo = {
      getCurrentPosition: vi.fn((success) => {
        setTimeout(() => success(mockPosition), 0);
      }),
      watchPosition: vi.fn((success) => {
        setTimeout(() => success(mockPosition), 0);
        return 42;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(navigator, "geolocation", {
      value: geo,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("does not request when paused", async () => {
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation is-paused></provider-geolocation>`,
    );
    expect(el).dom.to.equalTag(
      `<provider-geolocation is-paused></provider-geolocation>`,
    );
    expect(el.provision).toBe(null);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("gets coordinates on connect", async () => {
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation></provider-geolocation>`,
    );
    expect(el.isRequesting).toBe(true);
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { maximumAge: 60000, timeout: Infinity, enableHighAccuracy: false },
    );

    await waitForEvent(el, "provider-geolocation-success");

    expect(el).dom.to.equalTag(
      `<provider-geolocation is-success></provider-geolocation>`,
    );
    expect(el.provision).toEqual(expectedData);
  });

  it("requests when isPaused is unset", async () => {
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation is-paused></provider-geolocation>`,
    );
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();

    el.isPaused = false;
    expect(el.isRequesting).toBe(true);
    expect(geo.getCurrentPosition).toHaveBeenCalled();

    await waitForEvent(el, "provider-geolocation-success");
    expect(el.isSuccess).toBe(true);
    expect(el.provision).toEqual(expectedData);
  });

  it("handles geolocation error", async () => {
    geo.getCurrentPosition.mockImplementation((_success, error) => {
      setTimeout(() => error(mockGeoError), 0);
    });

    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation></provider-geolocation>`,
    );
    expect(el.isRequesting).toBe(true);

    await waitForEvent(el, "provider-geolocation-error");

    expect(el).dom.to.equalTag(
      `<provider-geolocation is-error></provider-geolocation>`,
    );
    expect(el.provision).toEqual(mockGeoError);
  });

  it("uses watchPosition when configured", async () => {
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation watch-position></provider-geolocation>`,
    );
    expect(geo.watchPosition).toHaveBeenCalled();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();

    await waitForEvent(el, "provider-geolocation-success");
    expect(el.isSuccess).toBe(true);
    expect(el.provision).toEqual(expectedData);
  });

  it("sets maximumAge to 0 when using watchPosition", async () => {
    fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation watch-position></provider-geolocation>`,
    );
    expect(geo.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ maximumAge: 0 }),
    );
  });

  it("clears watch on disconnect", async () => {
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation watch-position></provider-geolocation>`,
    );
    await waitForEvent(el, "provider-geolocation-success");

    el.remove();
    await wait(0);
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });

  it("keeps the watch when moved between parents", async () => {
    let nextWatchId = 42;
    geo.watchPosition.mockImplementation((success) => {
      setTimeout(() => success(mockPosition), 0);
      return nextWatchId++;
    });
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation watch-position></provider-geolocation>`,
    );
    await waitForEvent(el, "provider-geolocation-success");
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);

    const other = document.createElement("div");
    document.body.append(other);
    other.append(el);
    await wait(0);

    // a synchronous re-parent is a move: the watch is neither cleared nor
    // re-requested (a re-request would re-prompt for permission)
    expect(geo.clearWatch).not.toHaveBeenCalled();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(el.existingWatchId).toBe(42);
    expect(el.isSuccess).toBe(true);
  });

  it("restarts the watch after a genuine disconnect and reconnect", async () => {
    let nextWatchId = 42;
    geo.watchPosition.mockImplementation((success) => {
      setTimeout(() => success(mockPosition), 0);
      return nextWatchId++;
    });
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation watch-position></provider-geolocation>`,
    );
    await waitForEvent(el, "provider-geolocation-success");
    const parent = el.parentElement!;

    el.remove();
    await wait(0);
    expect(geo.clearWatch).toHaveBeenCalledWith(42);

    await waitForEvent(el, "provider-geolocation-success", () => {
      parent.append(el);
    });
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(el.existingWatchId).toBe(43);
  });

  it("drops a position that resolves after the element was removed", async () => {
    let resolvePosition: (position: typeof mockPosition) => void;
    geo.getCurrentPosition.mockImplementation((success) => {
      resolvePosition = success;
    });
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation></provider-geolocation>`,
    );
    expect(el.isRequesting).toBe(true);
    const spy = vi.fn();
    el.addEventListener("provider-geolocation-success", spy);

    el.remove();
    await wait(0);
    resolvePosition!(mockPosition);
    await wait(0);

    expect(spy).not.toHaveBeenCalled();
    expect(el.isSuccess).toBeFalsy();
    expect(el.provision).toBeFalsy();
  });

  it("drops an error that resolves after the element was removed", async () => {
    let rejectPosition: (error: typeof mockGeoError) => void;
    geo.getCurrentPosition.mockImplementation((_success, error) => {
      rejectPosition = error;
    });
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation></provider-geolocation>`,
    );
    const spy = vi.fn();
    el.addEventListener("provider-geolocation-error", spy);

    el.remove();
    await wait(0);
    rejectPosition!(mockGeoError);
    await wait(0);

    expect(spy).not.toHaveBeenCalled();
    expect(el.isError).toBeFalsy();
    expect(el.provision).toBeFalsy();
  });

  it("re-requests on the --request command", async () => {
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation></provider-geolocation>`,
    );
    await waitForEvent(el, "provider-geolocation-success");
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);

    invokeCommand(el, "--request");
    await wait(0);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);

    await waitForEvent(el, "provider-geolocation-success");
    expect(el.isSuccess).toBe(true);
  });

  it("passes custom options to the geolocation API", async () => {
    fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation high-accuracy geo-timeout="5000" maximum-age="30000"></provider-geolocation>`,
    );
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { maximumAge: 30000, timeout: 5000, enableHighAccuracy: true },
    );
  });

  it("defaults enableHighAccuracy to false when high-accuracy is unset", async () => {
    const el = fixture<HTMLProviderGeolocationElement>(
      `<provider-geolocation is-paused></provider-geolocation>`,
    );
    // a nullish prop value still resolves to the API default
    (el as any).highAccuracy = null;
    invokeCommand(el, "--request");
    await wait(0);

    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: false }),
    );
  });

  describe("success payload", () => {
    it("normalizes null optional coordinate fields to undefined", async () => {
      geo.getCurrentPosition.mockImplementation((success) => {
        setTimeout(
          () =>
            success({
              coords: {
                latitude: 1,
                longitude: 2,
                accuracy: null,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: 5,
            }),
          0,
        );
      });

      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      await waitForEvent(el, "provider-geolocation-success");

      const { coords } = el.provision as any;
      expect(coords).toEqual({ latitude: 1, longitude: 2, timestamp: 5 });
      for (const key of [
        "accuracy",
        "altitude",
        "altitudeAccuracy",
        "heading",
        "speed",
      ]) {
        expect(key in coords).toBe(true);
        expect(coords[key]).toBeUndefined();
      }
    });

    it("exposes the success detail as the event detail", async () => {
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      const spy = vi.fn();
      el.addEventListener("provider-geolocation-success", spy);
      await waitForEvent(el, "provider-geolocation-success");

      expect(spy.mock.calls[0][0].detail).toEqual(expectedData);
      expect(el.provision).toBe(spy.mock.calls[0][0].detail);
    });

    it("clears is-requesting and is-error on success", async () => {
      geo.getCurrentPosition.mockImplementationOnce((_success, error) => {
        setTimeout(() => error(mockGeoError), 0);
      });
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      await waitForEvent(el, "provider-geolocation-error");
      expect(el.isError).toBe(true);

      await waitForEvent(el, "provider-geolocation-success", () => {
        invokeCommand(el, "--request");
      });

      expect(el).dom.to.equalTag(
        `<provider-geolocation is-success></provider-geolocation>`,
      );
    });

    it("publishes provision with neutron-provision", async () => {
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      const spy = vi.fn();
      el.addEventListener("neutron-provision", spy);
      await waitForEvent(el, "provider-geolocation-success");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("error paths", () => {
    it("reports permission denied", async () => {
      geo.getCurrentPosition.mockImplementation((_success, error) => {
        setTimeout(() => error({ ...mockGeoError, code: 1 }), 0);
      });
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      await waitForEvent(el, "provider-geolocation-error");
      expect((el.provision as GeolocationPositionError).code).toBe(1);
      expect(el.isRequesting).toBe(false);
      expect(el.isSuccess).toBe(false);
    });

    it("reports a timeout", async () => {
      geo.getCurrentPosition.mockImplementation((_success, error, options) => {
        setTimeout(
          () =>
            error({
              ...mockGeoError,
              code: 3,
              message: `Timeout expired after ${options.timeout}ms`,
            }),
          0,
        );
      });
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation geo-timeout="10"></provider-geolocation>`,
      );
      await waitForEvent(el, "provider-geolocation-error");
      expect(el).dom.to.equalTag(
        `<provider-geolocation geo-timeout="10" is-error></provider-geolocation>`,
      );
      expect((el.provision as GeolocationPositionError).code).toBe(3);
      expect((el.provision as GeolocationPositionError).message).toBe(
        "Timeout expired after 10ms",
      );
    });

    it("reports position unavailable", async () => {
      geo.getCurrentPosition.mockImplementation((_success, error) => {
        setTimeout(() => error({ ...mockGeoError, code: 2 }), 0);
      });
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      await waitForEvent(el, "provider-geolocation-error");
      expect((el.provision as GeolocationPositionError).code).toBe(2);
    });

    it("emits error when the Geolocation API throws synchronously", async () => {
      const thrown = new TypeError("boom");
      geo.getCurrentPosition.mockImplementation(() => {
        throw thrown;
      });

      // the throw happens during connect, so listen before connecting
      const el = document.createElement("provider-geolocation");
      const spy = vi.fn();
      el.addEventListener("provider-geolocation-error", spy);
      document.body.append(el);
      await wait(0);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].detail).toBe(thrown);
      expect(el).dom.to.equalTag(
        `<provider-geolocation is-error></provider-geolocation>`,
      );
      expect(el.provision).toBe(thrown);
      expect(el.existingWatchId).toBe(null);
    });

    it("emits error when navigator.geolocation is unavailable", async () => {
      Object.defineProperty(navigator, "geolocation", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const el = document.createElement("provider-geolocation");
      const spy = vi.fn();
      el.addEventListener("provider-geolocation-error", spy);
      document.body.append(el);
      await wait(0);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(el.isError).toBe(true);
      expect(el.provision).toBeInstanceOf(Error);
    });

    it("emits error as event detail", async () => {
      geo.getCurrentPosition.mockImplementation((_success, error) => {
        setTimeout(() => error(mockGeoError), 0);
      });
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      const spy = vi.fn();
      el.addEventListener("provider-geolocation-error", spy);
      await waitForEvent(el, "provider-geolocation-error");
      expect(spy.mock.calls[0][0].detail).toBe(mockGeoError);
    });
  });

  describe("watch-position", () => {
    it("fires success on every update and stays is-success", async () => {
      let update: (p: typeof mockPosition) => void = () => {};
      geo.watchPosition.mockImplementation((success) => {
        update = success;
        return 7;
      });

      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation watch-position></provider-geolocation>`,
      );
      const spy = vi.fn();
      el.addEventListener("provider-geolocation-success", spy);
      expect(el.existingWatchId).toBe(7);

      update(mockPosition);
      update({ ...mockPosition, coords: { ...mockPosition.coords, speed: 9 } });

      // events are synchronous; the default action (state) lands a tick later
      expect(spy).toHaveBeenCalledTimes(2);
      await wait(0);
      expect(el).dom.to.equalTag(
        `<provider-geolocation is-success watch-position></provider-geolocation>`,
      );
      expect((el.provision as any).coords.speed).toBe(9);
    });

    it("clears the previous watch when a new request is made", async () => {
      let id = 40;
      geo.watchPosition.mockImplementation(() => ++id);

      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation watch-position></provider-geolocation>`,
      );
      expect(el.existingWatchId).toBe(41);

      invokeCommand(el, "--request");
    await wait(0);

      expect(geo.clearWatch).toHaveBeenCalledWith(41);
      expect(el.existingWatchId).toBe(42);
    });

    it("does not call clearWatch on disconnect for a one-shot request", async () => {
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation></provider-geolocation>`,
      );
      await waitForEvent(el, "provider-geolocation-success");
      expect(el.existingWatchId).toBe(null);

      el.remove();
      await wait(0);
      expect(geo.clearWatch).not.toHaveBeenCalled();
    });

    it("clears the watch while a request is still pending", async () => {
      geo.watchPosition.mockImplementation(() => 99);
      const el = fixture<HTMLProviderGeolocationElement>(
        `<provider-geolocation watch-position></provider-geolocation>`,
      );
      expect(el.isRequesting).toBe(true);

      el.remove();
      await wait(0);
      expect(geo.clearWatch).toHaveBeenCalledWith(99);
      expect(el.existingWatchId).toBe(null);
    });
  });
});
