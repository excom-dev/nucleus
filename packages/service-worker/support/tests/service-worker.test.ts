import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

/*
 * Like a real `EventTarget`: several listeners per type, de-duplicated
 * and removed by identity. The element registers its own
 * `controllerchange` next to the relayed one.
 */
function createSwMock() {
  const listeners: Record<string, Function[]> = {};
  return {
    addEventListener: vi.fn((type: string, cb: Function) => {
      const list = (listeners[type] ??= []);
      if (!list.includes(cb)) list.push(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: Function) => {
      const list = (listeners[type] ?? []).filter((l) => l !== cb);
      if (list.length) listeners[type] = list;
      else delete listeners[type];
    }),
    dispatchEvent: (event: Event) => {
      [...(listeners[event.type] ?? [])].forEach((cb) => cb(event));
    },
    ready: Promise.resolve() as Promise<unknown>,
    controller: null as unknown,
    _listeners: listeners,
  };
}

const relayCalls = (spy: ReturnType<typeof vi.fn>, type: string) =>
  spy.mock.calls.filter(([t]) => t === type);

describe("service-worker", () => {
  let swMock: ReturnType<typeof createSwMock>;
  const actualSW = navigator.serviceWorker;

  beforeEach(() => {
    swMock = createSwMock();
    Object.defineProperty(navigator, "serviceWorker", {
      value: swMock,
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "serviceWorker", {
      value: actualSW,
      configurable: true,
    });
  });

  it("defines the service-worker custom element", () => {
    expect(customElements.get("service-worker")).toBeTruthy();
  });

  it("sets isSupported and isReady on connect", async () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker></service-worker>`,
    );

    expect(el.isSupported).toBe(true);

    await wait(0);

    expect(el).dom.to.equalTag(
      `<service-worker is-mounted is-ready is-supported></service-worker>`,
    );
  });

  it("reflects isMounted by default", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker></service-worker>`,
    );

    expect(el).dom.to.equalTag(
      `<service-worker is-mounted is-supported></service-worker>`,
    );
  });

  it("relays all default SW events when relay-events is bare", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );

    let received = "";
    el.addEventListener("message", (e) => {
      received = (e as CustomEvent).detail;
    });

    swMock.dispatchEvent(new MessageEvent("message", { data: "hello" }));

    expect(received).toBe("hello");
  });

  it("only relays specified events when relay-events has a value", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events="controllerchange"></service-worker>`,
    );

    const messageSpy = vi.fn();
    const controllerSpy = vi.fn();
    el.addEventListener("message", messageSpy);
    el.addEventListener("controllerchange", controllerSpy);

    swMock.dispatchEvent(new MessageEvent("message", { data: "hello" }));
    expect(messageSpy).not.toHaveBeenCalled();

    swMock.dispatchEvent(new Event("controllerchange"));
    expect(controllerSpy).toHaveBeenCalledTimes(1);
  });

  it("removes all SW event listeners when relay-events is removed", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );

    const messageSpy = vi.fn();
    el.addEventListener("message", messageSpy);

    el.removeAttribute("relay-events");

    swMock.dispatchEvent(new MessageEvent("message", { data: "hello" }));

    expect(messageSpy).not.toHaveBeenCalled();
    expect(swMock.removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  it("removes previous relay listeners when relay-events value changes", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events="message"></service-worker>`,
    );

    expect(swMock._listeners["message"]).toBeDefined();

    el.setAttribute("relay-events", "controllerchange");

    expect(swMock.removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    expect(swMock._listeners["controllerchange"]).toBeDefined();
  });

  it("cleans up event listeners on disconnect", async () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );

    el.remove();
    await wait(0);

    expect(swMock.removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    expect(swMock.removeEventListener).toHaveBeenCalledWith(
      "messageerror",
      expect.any(Function),
    );
    expect(swMock.removeEventListener).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
    );
  });

  it("relays messageerror events", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );

    const spy = vi.fn();
    el.addEventListener("messageerror", spy);

    swMock.dispatchEvent(
      new MessageEvent("messageerror", { data: "error data" }),
    );

    expect(spy).toHaveBeenCalled();
  });

  it("emits event with correct detail from SW message data", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );

    let detail: any;
    el.addEventListener("message", (e) => {
      detail = (e as CustomEvent).detail;
    });

    swMock.dispatchEvent(
      new MessageEvent("message", { data: { type: "CACHE_UPDATED", url: "/api" } }),
    );

    expect(detail).toEqual({ type: "CACHE_UPDATED", url: "/api" });
  });

  it("relays controllerchange", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events="controllerchange"></service-worker>`,
    );
    const spy = vi.fn();
    el.addEventListener("controllerchange", spy);

    swMock.dispatchEvent(new Event("controllerchange"));

    expect(spy).toHaveBeenCalledTimes(1);
    // a plain Event has no `data`, so the relayed detail is empty
    expect(spy.mock.calls[0][0].detail).toBeNull();
  });

  it("relays several named events at once", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events="message controllerchange"></service-worker>`,
    );
    const message = vi.fn();
    const controllerchange = vi.fn();
    const messageerror = vi.fn();
    el.addEventListener("message", message);
    el.addEventListener("controllerchange", controllerchange);
    el.addEventListener("messageerror", messageerror);

    swMock.dispatchEvent(new MessageEvent("message", { data: 1 }));
    swMock.dispatchEvent(new Event("controllerchange"));
    swMock.dispatchEvent(new MessageEvent("messageerror", { data: 2 }));

    expect(message).toHaveBeenCalledTimes(1);
    expect(controllerchange).toHaveBeenCalledTimes(1);
    expect(messageerror).not.toHaveBeenCalled();
    expect(swMock._listeners["messageerror"]).toBeUndefined();
  });

  it("starts relaying when relay-events is added after connect", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker></service-worker>`,
    );
    // only the element's own `controllerchange` listener so far
    expect(relayCalls(swMock.addEventListener, "message")).toHaveLength(0);
    expect(relayCalls(swMock.addEventListener, "messageerror")).toHaveLength(0);

    el.setAttribute("relay-events", "message");

    expect(swMock.addEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    const spy = vi.fn();
    el.addEventListener("message", spy);
    swMock.dispatchEvent(new MessageEvent("message", { data: "late" }));
    expect(spy.mock.calls[0][0].detail).toBe("late");
  });

  it("stores the container in swContainer", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker></service-worker>`,
    );
    expect(el.swContainer).toBe(swMock);
  });

  it("does not set is-ready while navigator.serviceWorker.ready is pending", async () => {
    let resolveReady!: () => void;
    swMock.ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker></service-worker>`,
    );
    await wait(0);
    expect(el).dom.to.equalTag(
      `<service-worker is-mounted is-supported></service-worker>`,
    );

    resolveReady();
    await wait(0);
    expect(el).dom.to.equalTag(
      `<service-worker is-mounted is-ready is-supported></service-worker>`,
    );
  });

  it("keeps its relay listeners when moved synchronously within the document", async () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );
    const parent = el.parentElement!;
    const spy = vi.fn();
    el.addEventListener("message", spy);

    el.remove();
    parent.append(el);
    await wait(0);

    // the relay listeners are untouched by a move (Neutron re-registers
    // only its own tracked `controllerchange` listener)
    expect(relayCalls(swMock.removeEventListener, "message")).toHaveLength(0);
    expect(
      relayCalls(swMock.removeEventListener, "messageerror"),
    ).toHaveLength(0);
    swMock.dispatchEvent(new MessageEvent("message", { data: "moved" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(el.swContainer).toBe(swMock);

    // the internal listener survives the move too
    swMock.controller = {};
    swMock.dispatchEvent(new Event("controllerchange"));
    expect(el.provision?.hasController).toBe(true);
  });

  it("stops relaying after a real disconnect", async () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );
    const spy = vi.fn();
    el.addEventListener("message", spy);

    el.remove();
    await wait(0);

    swMock.dispatchEvent(new MessageEvent("message", { data: "gone" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-attaches the relay after a real disconnect and reconnect", async () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events="message controllerchange"></service-worker>`,
    );
    const message = vi.fn();
    const controllerchange = vi.fn();
    const messageerror = vi.fn();
    el.addEventListener("message", message);
    el.addEventListener("controllerchange", controllerchange);
    el.addEventListener("messageerror", messageerror);

    el.remove();
    await wait(0);
    expect(swMock._listeners["message"]).toBeUndefined();

    document.body.append(el);
    await wait(0);

    swMock.dispatchEvent(new MessageEvent("message", { data: "back" }));
    swMock.dispatchEvent(new Event("controllerchange"));
    swMock.dispatchEvent(new MessageEvent("messageerror", { data: "x" }));
    expect(message).toHaveBeenCalledTimes(1);
    expect(message.mock.calls[0][0].detail).toBe("back");
    expect(controllerchange).toHaveBeenCalledTimes(1);
    // still only the configured names
    expect(messageerror).not.toHaveBeenCalled();
    // and not registered twice
    expect(swMock._listeners["message"]).toHaveLength(1);
  });

  describe("provision", () => {
    it("is set on connect and again when ready resolves", async () => {
      swMock.ready = Promise.resolve({ scope: "/app/" });
      const el = fixture<HTMLServiceWorkerElement>(
        `<service-worker></service-worker>`,
      );
      expect(el.provision).toEqual({
        isSupported: true,
        isReady: false,
        hasController: false,
        scope: null,
      });

      await wait(0);
      expect(el.provision).toEqual({
        isSupported: true,
        isReady: true,
        hasController: false,
        scope: "/app/",
      });
      expect(el).dom.to.equalTag(
        `<service-worker is-mounted is-ready is-supported></service-worker>`,
      );
    });

    it("reads an existing controller on connect and leaves scope null without a registration", async () => {
      swMock.controller = {};
      const el = fixture<HTMLServiceWorkerElement>(
        `<service-worker></service-worker>`,
      );
      expect(el.provision?.hasController).toBe(true);
      await wait(0);
      expect(el.provision).toEqual({
        isSupported: true,
        isReady: true,
        hasController: true,
        scope: null,
      });
    });

    it("tracks controllerchange without relay-events and emits neutron-provision", async () => {
      const el = fixture<HTMLServiceWorkerElement>(
        `<service-worker></service-worker>`,
      );
      await wait(0);
      const relayed = vi.fn();
      const provisionSpy = vi.fn();
      el.addEventListener("controllerchange", relayed);
      el.addEventListener("neutron-provision", provisionSpy);
      const before = el.provision;

      swMock.controller = {};
      swMock.dispatchEvent(new Event("controllerchange"));

      expect(el.provision).toEqual({
        isSupported: true,
        isReady: true,
        hasController: true,
        scope: null,
      });
      expect(el.provision).not.toBe(before);
      expect(provisionSpy).toHaveBeenCalledTimes(1);
      // the internal listener never relays
      expect(relayed).not.toHaveBeenCalled();

      swMock.controller = null;
      swMock.dispatchEvent(new Event("controllerchange"));
      expect(el.provision?.hasController).toBe(false);
    });

    it("keeps tracking controllerchange after a real disconnect and reconnect", async () => {
      const el = fixture<HTMLServiceWorkerElement>(
        `<service-worker></service-worker>`,
      );
      el.remove();
      await wait(0);
      expect(swMock._listeners["controllerchange"]).toBeUndefined();

      document.body.append(el);
      await wait(0);
      expect(swMock._listeners["controllerchange"]).toHaveLength(1);

      swMock.controller = {};
      swMock.dispatchEvent(new Event("controllerchange"));
      expect(el.provision?.hasController).toBe(true);
    });

    it("ignores a ready that settles after the element left the document", async () => {
      let resolveReady!: (value: unknown) => void;
      swMock.ready = new Promise((resolve) => {
        resolveReady = resolve;
      });
      const el = fixture<HTMLServiceWorkerElement>(
        `<service-worker></service-worker>`,
      );
      el.remove();
      await wait(0);

      resolveReady({ scope: "/late/" });
      await wait(0);

      expect(el.isReady).toBe(false);
      expect(el.provision?.isReady).toBe(false);
      expect(el.provision?.scope).toBe(null);
    });
  });
});

describe("service-worker (unsupported)", () => {
  let desc: PropertyDescriptor | undefined;

  beforeEach(() => {
    desc = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    // @ts-expect-error
    delete navigator.serviceWorker;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    if (desc) {
      Object.defineProperty(navigator, "serviceWorker", desc);
    }
  });

  it("does not set isSupported when serviceWorker is unavailable", () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker></service-worker>`,
    );

    expect(el).dom.to.equalTag(`<service-worker is-mounted></service-worker>`);
    expect(el.swContainer).toBe(null);
    expect(el.isReady).toBeFalsy();
    expect(el.provision).toEqual({
      isSupported: false,
      isReady: false,
      hasController: false,
      scope: null,
    });
  });

  it("tolerates relay-events being set, changed, removed and disconnected", async () => {
    const el = fixture<HTMLServiceWorkerElement>(
      `<service-worker relay-events></service-worker>`,
    );
    expect(el).dom.to.equalTag(
      `<service-worker is-mounted relay-events></service-worker>`,
    );

    expect(() => {
      el.setAttribute("relay-events", "message");
      el.removeAttribute("relay-events");
    }).not.toThrow();

    el.remove();
    await wait(0);
    expect(el.isMounted).toBe(false);
  });
});
