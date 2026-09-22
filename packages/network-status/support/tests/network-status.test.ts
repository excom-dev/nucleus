import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

const setOnLine = (value: boolean) =>
  Object.defineProperty(navigator, "onLine", {
    writable: true,
    configurable: true,
    value,
  });

const createConnection = (fields: Record<string, unknown> = {}) => {
  const connection = new EventTarget();
  Object.assign(connection, {
    type: "wifi",
    effectiveType: "4g",
    downlink: 10,
    rtt: 50,
    ...fields,
  });
  return connection as EventTarget & Record<string, any>;
};

const mount = () =>
  fixture<HTMLNetworkStatusElement>(`<network-status></network-status>`);

describe("network-status", () => {
  const originalConnection = Object.getOwnPropertyDescriptor(
    navigator,
    "connection",
  );

  const setConnection = (name: string, value: unknown) =>
    Object.defineProperty(navigator, name, {
      value,
      writable: true,
      configurable: true,
    });

  beforeAll(() => {
    setOnLine(true);
  });

  beforeEach(() => {
    setOnLine(true);
    for (const name of ["connection", "mozConnection", "webkitConnection"]) {
      setConnection(name, undefined);
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  afterAll(() => {
    vi.clearAllMocks();
    for (const name of ["connection", "mozConnection", "webkitConnection"]) {
      delete (navigator as any)[name];
    }
    if (originalConnection) {
      Object.defineProperty(navigator, "connection", originalConnection);
    }
  });

  it("responds to online/offline/change events", () => {
    const mockNetworkConnection = createConnection({ type: "cellular" });
    setConnection("connection", mockNetworkConnection);

    const networkStatus = mount();

    expect(networkStatus).dom.to.equalTag(
      `<network-status connection-type="cellular" effective-type="4g" is-mounted is-online></network-status>`,
    );
    expect(networkStatus.provision?.downlink).toBe(10);
    expect(networkStatus.provision?.rtt).toBe(50);
    // the first read is state, not a transition, no stamps yet
    expect(networkStatus.provision?.lastOnline).toBeUndefined();
    expect(networkStatus.provision?.lastOffline).toBeUndefined();

    // Simulate going offline
    setOnLine(false);
    window.dispatchEvent(new Event("offline"));
    expect(networkStatus).dom.to.equalTag(
      `<network-status connection-type="cellular" effective-type="4g" is-mounted></network-status>`,
    );
    expect(networkStatus.provision?.downlink).toBe(10);
    expect(networkStatus.provision?.rtt).toBe(50);
    expect(networkStatus.provision?.lastOnline).toBeUndefined();
    expect(networkStatus.provision?.lastOffline).toBeDefined();

    // Simulate going online
    setOnLine(true);
    window.dispatchEvent(new Event("online"));
    expect(networkStatus).dom.to.equalTag(
      `<network-status connection-type="cellular" effective-type="4g" is-mounted is-online></network-status>`,
    );
    expect(networkStatus.provision?.downlink).toBe(10);
    expect(networkStatus.provision?.rtt).toBe(50);
    expect(networkStatus.provision?.lastOnline).toBeDefined();
    expect(networkStatus.provision?.lastOffline).toBeDefined();

    // Simulate network change
    mockNetworkConnection.type = "wifi";
    mockNetworkConnection.effectiveType = null;
    mockNetworkConnection.downlink = 20;
    mockNetworkConnection.rtt = 100;
    mockNetworkConnection.dispatchEvent(new Event("change"));
    expect(networkStatus).dom.to.equalTag(
      `<network-status connection-type="wifi" is-mounted is-online></network-status>`,
    );
    expect(networkStatus.provision?.downlink).toBe(20);
    expect(networkStatus.provision?.rtt).toBe(100);
    expect(networkStatus.provision?.lastOnline).toBeDefined();
    expect(networkStatus.provision?.lastOffline).toBeDefined();
  });

  describe("without the Network Information API", () => {
    it("still reports online state and leaves connection fields unset", () => {
      const el = mount();

      expect(el).dom.to.equalTag(
        `<network-status is-mounted is-online></network-status>`,
      );
      expect(el.provision).toEqual(
        expect.objectContaining({
          isOnline: true,
          connectionType: undefined,
          effectiveType: undefined,
          downlink: undefined,
          rtt: undefined,
        }),
      );
      expect(el.provision?.lastOnline).toBeUndefined();
      expect(el.provision?.lastOffline).toBeUndefined();
    });

    it("reports offline on connect when navigator.onLine is false", () => {
      setOnLine(false);
      const el = mount();

      expect(el).dom.to.equalTag(
        `<network-status is-mounted></network-status>`,
      );
      expect(el.provision?.isOnline).toBe(false);
      expect(el.provision?.lastOnline).toBeUndefined();
      expect(el.provision?.lastOffline).toBeUndefined();
    });

    it("does not emit at mount; emits network-status-online after offline → online", () => {
      const el = document.createElement("network-status");
      const online = vi.fn();
      const offline = vi.fn();
      const change = vi.fn();
      const provisionSpy = vi.fn();
      el.addEventListener("network-status-online", online);
      el.addEventListener("network-status-offline", offline);
      el.addEventListener("network-status-change", change);
      el.addEventListener("neutron-provision", provisionSpy);

      document.body.append(el);

      // state is set, but the first read is not a transition
      expect(el.hasAttribute("is-online")).toBe(true);
      expect(el.provision?.isOnline).toBe(true);
      expect(provisionSpy).toHaveBeenCalledTimes(1);
      expect(online).not.toHaveBeenCalled();
      expect(offline).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();

      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
      expect(offline).toHaveBeenCalledTimes(1);
      expect(online).not.toHaveBeenCalled();

      setOnLine(true);
      window.dispatchEvent(new Event("online"));
      expect(online).toHaveBeenCalledTimes(1);
      expect(online.mock.calls[0][0].detail.isOnline).toBe(true);
      expect(change).not.toHaveBeenCalled();
    });

    it("reports offline on connect without emitting, then emits network-status-online", () => {
      setOnLine(false);
      const el = document.createElement("network-status");
      const online = vi.fn();
      const offline = vi.fn();
      el.addEventListener("network-status-online", online);
      el.addEventListener("network-status-offline", offline);

      document.body.append(el);
      expect(el.hasAttribute("is-online")).toBe(false);
      expect(offline).not.toHaveBeenCalled();

      setOnLine(true);
      window.dispatchEvent(new Event("online"));
      expect(online).toHaveBeenCalledTimes(1);
      expect(offline).not.toHaveBeenCalled();
    });

    it("transitions offline and online from window events", () => {
      const el = mount();
      const online = vi.fn();
      const offline = vi.fn();
      const change = vi.fn();
      el.addEventListener("network-status-online", online);
      el.addEventListener("network-status-offline", offline);
      el.addEventListener("network-status-change", change);

      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
      expect(el.hasAttribute("is-online")).toBe(false);
      expect(offline).toHaveBeenCalledTimes(1);
      expect(offline.mock.calls[0][0].detail).toBe(el.provision);
      expect(offline.mock.calls[0][0].detail.isOnline).toBe(false);

      setOnLine(true);
      window.dispatchEvent(new Event("online"));
      expect(el.hasAttribute("is-online")).toBe(true);
      expect(online).toHaveBeenCalledTimes(1);
      expect(online.mock.calls[0][0].detail).toBe(el.provision);
      expect(online.mock.calls[0][0].detail.isOnline).toBe(true);

      expect(change).not.toHaveBeenCalled();
    });

    it("preserves lastOnline / lastOffline across transitions", () => {
      vi.spyOn(Date, "now").mockReturnValue(1000);
      const el = mount();
      // mount is not a transition, so nothing is stamped
      expect(el.provision?.lastOnline).toBeUndefined();

      vi.spyOn(Date, "now").mockReturnValue(2000);
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
      expect(el.provision?.lastOnline).toBeUndefined();
      expect(el.provision?.lastOffline).toBe(2000);

      vi.spyOn(Date, "now").mockReturnValue(3000);
      setOnLine(true);
      window.dispatchEvent(new Event("online"));
      expect(el.provision?.lastOnline).toBe(3000);
      expect(el.provision?.lastOffline).toBe(2000);
    });

    it("emits network-status-change when online fires without a transition", () => {
      const el = mount();
      const online = vi.fn();
      const change = vi.fn();
      el.addEventListener("network-status-online", online);
      el.addEventListener("network-status-change", change);

      // already online, a second `online` is not a transition
      window.dispatchEvent(new Event("online"));

      expect(online).not.toHaveBeenCalled();
      expect(change).toHaveBeenCalledTimes(1);
      expect(el.hasAttribute("is-online")).toBe(true);
    });
  });

  describe("Network Information API", () => {
    it("reads type / effectiveType / downlink / rtt from navigator.connection", () => {
      setConnection(
        "connection",
        createConnection({ type: "ethernet", effectiveType: "4g", downlink: 100, rtt: 5 }),
      );
      const el = mount();

      expect(el).dom.to.equalTag(
        `<network-status connection-type="ethernet" effective-type="4g" is-mounted is-online></network-status>`,
      );
      expect(el.provision).toEqual(
        expect.objectContaining({ downlink: 100, rtt: 5 }),
      );
    });

    it("falls back to navigator.mozConnection", () => {
      setConnection("mozConnection", createConnection({ type: "cellular" }));
      const el = mount();
      expect(el.connectionType).toBe("cellular");
    });

    it("falls back to navigator.webkitConnection", () => {
      setConnection("webkitConnection", createConnection({ type: "bluetooth" }));
      const el = mount();
      expect(el.connectionType).toBe("bluetooth");
    });

    it("emits network-status-change (not online/offline) on a connection change", () => {
      const connection = createConnection({ effectiveType: "4g" });
      setConnection("connection", connection);
      const el = mount();
      const online = vi.fn();
      const offline = vi.fn();
      const change = vi.fn();
      el.addEventListener("network-status-online", online);
      el.addEventListener("network-status-offline", offline);
      el.addEventListener("network-status-change", change);

      connection.effectiveType = "slow-2g";
      connection.dispatchEvent(new Event("change"));

      expect(change).toHaveBeenCalledTimes(1);
      expect(change.mock.calls[0][0].detail.effectiveType).toBe("slow-2g");
      expect(el.effectiveType).toBe("slow-2g");
      expect(online).not.toHaveBeenCalled();
      expect(offline).not.toHaveBeenCalled();
    });

    it("subscribes to the connection's change event and unsubscribes on disconnect", async () => {
      const connection = createConnection();
      const addSpy = vi.spyOn(connection, "addEventListener");
      const removeSpy = vi.spyOn(connection, "removeEventListener");
      setConnection("connection", connection);

      const el = mount();
      expect(addSpy).toHaveBeenCalledWith("change", expect.any(Function));
      const handler = addSpy.mock.calls[0][1];

      el.remove();
      await wait(0);

      expect(removeSpy).toHaveBeenCalledWith("change", handler);
      expect(el.networkConnection).toBe(null);
    });
  });

  describe("lifecycle", () => {
    it("removes window listeners on disconnect and stops updating", async () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const el = mount();

      el.remove();
      await wait(0);

      expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));

      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
      expect(el.isOnline).toBe(true);
    });

    it("keeps its listeners when moved synchronously within the document", async () => {
      const connection = createConnection();
      const connectionRemove = vi.spyOn(connection, "removeEventListener");
      const connectionAdd = vi.spyOn(connection, "addEventListener");
      setConnection("connection", connection);
      const windowRemove = vi.spyOn(window, "removeEventListener");

      const el = mount();
      const parent = el.parentElement!;
      expect(connectionAdd).toHaveBeenCalledTimes(1);

      el.remove();
      parent.append(el);
      await wait(0);

      expect(windowRemove).not.toHaveBeenCalledWith(
        "online",
        expect.any(Function),
      );
      expect(connectionRemove).not.toHaveBeenCalled();
      // not re-subscribed either
      expect(connectionAdd).toHaveBeenCalledTimes(1);
      expect(el.networkConnection).toBe(connection);

      // still live after the move
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
      expect(el.hasAttribute("is-online")).toBe(false);
    });

    it("re-subscribes when reconnected after a real disconnect", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const el = mount();
      const onlineAdds = () =>
        addSpy.mock.calls.filter(([type]) => type === "online").length;
      expect(onlineAdds()).toBe(1);

      el.remove();
      await wait(0);
      document.body.append(el);
      await wait(0);

      expect(onlineAdds()).toBe(2);
      expect(el.hasAttribute("is-online")).toBe(true);
    });
  });
});
