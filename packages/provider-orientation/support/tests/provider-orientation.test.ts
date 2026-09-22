import { invokeCommand } from "@excom/neutron";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

// Window listener goes through Neutron's tracked registry, which passes
// `{ capture: true }`, not the bare `true` flag.
const CAPTURE = expect.objectContaining({ capture: true });

describe("provider-orientation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defines the provider-orientation custom element", async () => {
    expect(customElements.get("provider-orientation")).toBeTruthy();
  });

  describe("makeRequest (Android / desktop — no requestPermission)", () => {
    it("adds deviceorientationabsolute listener on connect when available", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      (window as any).ondeviceorientationabsolute = null;

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientationabsolute",
        expect.any(Function),
        CAPTURE,
      );
      expect(el).dom.to.equalTag(
        `<provider-orientation is-success></provider-orientation>`,
      );

      delete (window as any).ondeviceorientationabsolute;
    });

    it("falls back to deviceorientation when absolute is not available", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
      expect(el).dom.to.equalTag(
        `<provider-orientation is-success></provider-orientation>`,
      );
    });

    it("does not auto-request when isPaused is set", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation is-paused></provider-orientation>`,
      );

      expect(addSpy).not.toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
      expect(el).dom.to.equalTag(
        `<provider-orientation is-paused></provider-orientation>`,
      );
    });

    it("requests when isPaused is unset", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation is-paused></provider-orientation>`,
      );

      expect(addSpy).not.toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );

      el.isPaused = false;

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
    });

    it("requests via the --request command", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation is-paused></provider-orientation>`,
      );

      invokeCommand(el, "--request");
      await wait(0);

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
    });
  });

  describe("makeRequest (no DeviceOrientationEvent constructor at all)", () => {
    it("falls back to the plain listener path", async () => {
      vi.stubGlobal("DeviceOrientationEvent", undefined);
      const addSpy = vi.spyOn(window, "addEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
      expect(el).dom.to.equalTag(
        `<provider-orientation is-success></provider-orientation>`,
      );
    });
  });

  describe("makeRequest (iOS — requestPermission)", () => {
    it("adds the absolute listener after permission is granted when available", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      (window as any).ondeviceorientationabsolute = null;
      vi.stubGlobal("DeviceOrientationEvent", {
        requestPermission: () => Promise.resolve("granted"),
      });

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      expect(el.isRequesting).toBe(true);

      await wait(10);

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientationabsolute",
        expect.any(Function),
        CAPTURE,
      );
      expect(addSpy).not.toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );

      delete (window as any).ondeviceorientationabsolute;
    });

    it("requests permission from a --request command while paused", async () => {
      const requestPermission = vi.fn(() => Promise.resolve("granted"));
      vi.stubGlobal("DeviceOrientationEvent", { requestPermission });

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation is-paused></provider-orientation>`,
      );
      expect(requestPermission).not.toHaveBeenCalled();

      invokeCommand(el, "--request");
      await wait(0);
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(el.isRequesting).toBe(true);
    });

    it("adds listener when permission is granted", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      vi.stubGlobal("DeviceOrientationEvent", {
        requestPermission: () => Promise.resolve("granted"),
      });

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      expect(el.isRequesting).toBe(true);

      await wait(10);

      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
    });

    it("emits error when permission is denied", async () => {
      vi.stubGlobal("DeviceOrientationEvent", {
        requestPermission: () => Promise.resolve("denied"),
      });

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      await waitForEvent(el, "provider-orientation-error");

      expect(el).dom.to.equalTag(
        `<provider-orientation is-error></provider-orientation>`,
      );
    });

    it("emits error when permission promise rejects", async () => {
      vi.stubGlobal("DeviceOrientationEvent", {
        requestPermission: () => Promise.reject(new Error("fail")),
      });

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      await waitForEvent(el, "provider-orientation-error");

      expect(el).dom.to.equalTag(
        `<provider-orientation is-error></provider-orientation>`,
      );
    });
  });

  describe("compassHandler", () => {
    it("calculates bearing from webkitCompassHeading (iOS)", async () => {
      let compassHandler: Function;
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type: string, handler: any) => {
          if (type === "deviceorientation") compassHandler = handler;
        },
      );

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      const successPromise = waitForEvent(el, "provider-orientation-success");

      compassHandler!({ webkitCompassHeading: 180 });

      await successPromise;

      expect(el.provision).toEqual({ bearing: 180, alpha: undefined });
    });

    it("calculates bearing from alpha with absolute (Android)", async () => {
      let compassHandler: Function;
      (window as any).ondeviceorientationabsolute = null;
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type: string, handler: any) => {
          if (type === "deviceorientationabsolute") compassHandler = handler;
        },
      );

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      const successPromise = waitForEvent(el, "provider-orientation-success");

      compassHandler!({ alpha: 90, absolute: true });

      await successPromise;

      expect(el.provision).toEqual({ bearing: 270, alpha: 90 });

      delete (window as any).ondeviceorientationabsolute;
    });

    it("ignores events without valid heading data", async () => {
      let compassHandler: Function;
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type: string, handler: any) => {
          if (type === "deviceorientation") compassHandler = handler;
        },
      );

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      const spy = vi.fn();
      el.addEventListener("provider-orientation-success", spy);

      compassHandler!({ alpha: 90, absolute: false });

      expect(spy).not.toHaveBeenCalled();
    });

    it("throttles updates based on compassThrottleMs", async () => {
      let compassHandler: Function;
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type: string, handler: any) => {
          if (type === "deviceorientation") compassHandler = handler;
        },
      );

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation compass-throttle-ms="200"></provider-orientation>`,
      );

      const spy = vi.fn();
      el.addEventListener("provider-orientation-success", spy);

      let now = 1000;
      vi.spyOn(Date, "now").mockImplementation(() => now);

      compassHandler!({ webkitCompassHeading: 90 });
      expect(spy).toHaveBeenCalledTimes(1);

      now = 1100;
      compassHandler!({ webkitCompassHeading: 180 });
      expect(spy).toHaveBeenCalledTimes(1);

      now = 1200;
      compassHandler!({ webkitCompassHeading: 270 });
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe("state management", () => {
    it("sets provision and isSuccess on compass success", async () => {
      let compassHandler: Function;
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type: string, handler: any) => {
          if (type === "deviceorientation") compassHandler = handler;
        },
      );

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      await waitForEvent(el, "provider-orientation-success", () => {
        compassHandler!({ webkitCompassHeading: 45 });
      });

      expect(el.isSuccess).toBe(true);
      expect(el.isError).toBeFalsy();
      expect(el.provision).toEqual({ bearing: 45, alpha: undefined });
    });

    it("sets provision and isError on permission denial", async () => {
      vi.stubGlobal("DeviceOrientationEvent", {
        requestPermission: () => Promise.resolve("denied"),
      });

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      await waitForEvent(el, "provider-orientation-error");

      expect(el).dom.to.equalTag(
        `<provider-orientation is-error></provider-orientation>`,
      );
      expect(el.provision).toBe("Device orientation permission denied");
    });
  });

  describe("disconnect", () => {
    it("removes deviceorientation listener on disconnect", async () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      el.remove();
      await wait(0);

      expect(removeSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
    });

    it("removes deviceorientationabsolute listener when available", async () => {
      (window as any).ondeviceorientationabsolute = null;
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );

      el.remove();
      await wait(0);

      expect(removeSpy).toHaveBeenCalledWith(
        "deviceorientationabsolute",
        expect.any(Function),
        CAPTURE,
      );

      delete (window as any).ondeviceorientationabsolute;
    });

    it("keeps its listener when moved synchronously within the document", async () => {
      let compassHandler: Function;
      const addSpy = vi
        .spyOn(window, "addEventListener")
        .mockImplementation((type: string, handler: any) => {
          if (type === "deviceorientation") compassHandler = handler;
        });
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const countCalls = (spy: typeof addSpy) =>
        spy.mock.calls.filter(([type]) => type === "deviceorientation").length;

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      const parent = el.parentElement!;

      el.remove();
      parent.append(el);
      await wait(0);

      // Neutron detaches and restores the tracked listener across the move,
      // without a second request: adds and removes balance to one listener
      expect(countCalls(addSpy) - countCalls(removeSpy)).toBe(1);
      expect(el).dom.to.equalTag(
        `<provider-orientation is-success></provider-orientation>`,
      );

      // still wired: a reading after the move still lands
      await waitForEvent(el, "provider-orientation-success", () => {
        compassHandler!({ webkitCompassHeading: 12 });
      });
      expect(el.provision).toEqual({ bearing: 12, alpha: undefined });
    });

    it("stops delivering readings after a real disconnect", async () => {
      let compassHandler: Function;
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type: string, handler: any) => {
          if (type === "deviceorientation") compassHandler = handler;
        },
      );
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      el.remove();
      await wait(0);

      expect(removeSpy).toHaveBeenCalledWith(
        "deviceorientation",
        compassHandler!,
        CAPTURE,
      );
    });

    it("re-attaches the listener after a genuine disconnect and reconnect", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const countCalls = (spy: typeof addSpy) =>
        spy.mock.calls.filter(([type]) => type === "deviceorientation").length;

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      const parent = el.parentElement!;
      expect(countCalls(addSpy)).toBe(1);

      el.remove();
      await wait(0);
      expect(countCalls(removeSpy)).toBe(1);

      parent.append(el);
      await wait(0);
      // restored by Neutron, and the connect-time request deduplicates
      expect(countCalls(addSpy) - countCalls(removeSpy)).toBe(1);
      expect(el).dom.to.equalTag(
        `<provider-orientation is-success></provider-orientation>`,
      );
    });
  });

  describe("disconnect while the permission prompt is open (iOS)", () => {
    const stubPendingPermission = () => {
      let resolvePermission!: (state: string) => void;
      let rejectPermission!: (error: Error) => void;
      vi.stubGlobal("DeviceOrientationEvent", {
        requestPermission: () =>
          new Promise<string>((resolve, reject) => {
            resolvePermission = resolve;
            rejectPermission = reject;
          }),
      });
      return {
        resolvePermission: (state: string) => resolvePermission(state),
        rejectPermission: (error: Error) => rejectPermission(error),
      };
    };

    it("does not attach a window listener when permission is granted after removal", async () => {
      const { resolvePermission } = stubPendingPermission();
      const addSpy = vi.spyOn(window, "addEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      expect(el.isRequesting).toBe(true);

      el.remove();
      await wait(0);
      resolvePermission("granted");
      await wait(10);

      expect(addSpy).not.toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        expect.anything(),
      );
      expect(addSpy).not.toHaveBeenCalledWith(
        "deviceorientationabsolute",
        expect.any(Function),
        expect.anything(),
      );
      expect(el.isSuccess).toBeFalsy();
    });

    it("leaves no window listener behind when the absolute event is available", async () => {
      (window as any).ondeviceorientationabsolute = null;
      const { resolvePermission } = stubPendingPermission();
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      el.remove();
      await wait(0);
      resolvePermission("granted");
      await wait(10);

      // never attached, so there is nothing a later removal could miss
      expect(addSpy).not.toHaveBeenCalledWith(
        "deviceorientationabsolute",
        expect.any(Function),
        expect.anything(),
      );
      expect(removeSpy).not.toHaveBeenCalledWith(
        "deviceorientationabsolute",
        expect.any(Function),
        expect.anything(),
      );

      delete (window as any).ondeviceorientationabsolute;
    });

    it("does not emit an error on a removed element when permission is denied", async () => {
      const { resolvePermission } = stubPendingPermission();
      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      const spy = vi.fn();
      el.addEventListener("provider-orientation-error", spy);

      el.remove();
      await wait(0);
      resolvePermission("denied");
      await wait(10);

      expect(spy).not.toHaveBeenCalled();
      expect(el.isError).toBeFalsy();
    });

    it("requests again when reconnected after the abandoned prompt", async () => {
      const { resolvePermission } = stubPendingPermission();
      const requestPermission = vi.spyOn(
        DeviceOrientationEvent as any,
        "requestPermission",
      );
      const addSpy = vi.spyOn(window, "addEventListener");

      const el = fixture<HTMLProviderOrientationElement>(
        `<provider-orientation></provider-orientation>`,
      );
      const parent = el.parentElement!;
      expect(requestPermission).toHaveBeenCalledTimes(1);

      el.remove();
      await wait(0);
      resolvePermission("granted");
      await wait(10);

      parent.append(el);
      expect(requestPermission).toHaveBeenCalledTimes(2);
      resolvePermission("granted");
      await wait(10);

      // only the second (connected) grant attaches, exactly one listener
      expect(
        addSpy.mock.calls.filter(([type]) => type === "deviceorientation"),
      ).toHaveLength(1);
      expect(addSpy).toHaveBeenCalledWith(
        "deviceorientation",
        expect.any(Function),
        CAPTURE,
      );
    });
  });
});
