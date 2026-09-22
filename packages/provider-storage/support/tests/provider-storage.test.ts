import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";
import type { ProviderStorageChangedEvent } from "../../index";

const mount = (attrs = "") =>
  fixture<HTMLProviderStorageElement>(
    `<provider-storage ${attrs}></provider-storage>`,
  );

/** Simulate another tab writing `key` in `storageArea`. */
const otherTabWrites = (
  key: string | null,
  newValue: unknown,
  storageArea: Storage = localStorage,
) => {
  const oldValue = key === null ? null : storageArea.getItem(key);
  if (key === null) {
    storageArea.clear();
  } else if (newValue === null) {
    storageArea.removeItem(key);
  } else {
    storageArea.setItem(key, JSON.stringify(newValue));
  }
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      oldValue,
      newValue: key === null || newValue === null ? null : JSON.stringify(newValue),
      storageArea,
    }),
  );
};

const flushDisconnect = () => new Promise<void>((r) => queueMicrotask(r));

describe("provider-storage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("reads data from localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    store.set("test-key", JSON.stringify({ ok: true }));

    const el = mount();
    el.setAttribute("key-name", "test-key");

    expect(el).dom.to.equalTag(
      `<provider-storage is-success key-name="test-key"></provider-storage>`,
    );
    expect(el.provision).toEqual({ ok: true });
  });

  describe("reading", () => {
    beforeEach(() => {
      localStorage.setItem("prefs", JSON.stringify({ theme: "dark" }));
      localStorage.setItem("count", "42");
      localStorage.setItem(
        "nested",
        JSON.stringify({ a: { b: [1, 2, { c: "d" }] } }),
      );
    });

    it("does nothing until key-name is set", () => {
      const el = mount();
      expect(el).dom.to.equalTag(`<provider-storage></provider-storage>`);
      expect(el.provision).toBe(null);
      expect(el.isSuccess).toBeFalsy();
      expect(el.isError).toBeFalsy();
    });

    it("reads on connect when key-name is present in the markup", () => {
      const el = mount(`key-name="prefs"`);
      expect(el).dom.to.equalTag(
        `<provider-storage is-success key-name="prefs"></provider-storage>`,
      );
      expect(el.provision).toEqual({ theme: "dark" });
    });

    it("parses primitives and nested structures", () => {
      const el = mount(`key-name="count"`);
      expect(el.provision).toBe(42);

      el.keyName = "nested";
      expect(el.provision).toEqual({ a: { b: [1, 2, { c: "d" }] } });
    });

    it("reads null for a missing key and still reports success", () => {
      const el = mount(`key-name="does-not-exist"`);
      expect(el).dom.to.equalTag(
        `<provider-storage is-success key-name="does-not-exist"></provider-storage>`,
      );
      expect(el.provision).toBe(null);
      expect(el.isError).toBe(false);
    });

    it("re-reads when key-name changes", () => {
      const el = mount(`key-name="prefs"`);
      expect(el.provision).toEqual({ theme: "dark" });

      el.setAttribute("key-name", "count");
      expect(el.provision).toBe(42);

      el.keyName = "prefs";
      expect(el.provision).toEqual({ theme: "dark" });
    });

    it("re-reads the current value when key-name is toggled off and on", () => {
      const el = mount(`key-name="prefs"`);
      expect(el.provision).toEqual({ theme: "dark" });

      // a same-tab write is not picked up on its own…
      localStorage.setItem("prefs", JSON.stringify({ theme: "light" }));
      expect(el.provision).toEqual({ theme: "dark" });

      // …until key-name is re-set (the documented workaround)
      el.keyName = "";
      el.keyName = "prefs";
      expect(el.provision).toEqual({ theme: "light" });
    });

    it("clears provision and both states when key-name is removed", () => {
      const el = mount(`key-name="prefs"`);
      expect(el.provision).toEqual({ theme: "dark" });

      el.removeAttribute("key-name");

      expect(el).dom.to.equalTag(`<provider-storage></provider-storage>`);
      expect(el.provision).toBe(null);
      expect(el.isSuccess).toBe(false);
      expect(el.isError).toBe(false);
    });

    it("clears is-error too when key-name is removed", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      localStorage.setItem("broken", "{not json");
      const el = mount(`key-name="broken"`);
      expect(el.isError).toBe(true);

      el.keyName = null as unknown as string;

      expect(el).dom.to.equalTag(`<provider-storage></provider-storage>`);
      expect(el.isError).toBe(false);
    });

    it("never writes to either store", () => {
      const setSpy = vi.spyOn(Storage.prototype, "setItem");
      const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
      const clearSpy = vi.spyOn(Storage.prototype, "clear");

      const el = mount(`key-name="prefs"`);
      el.keyName = "count";
      el.storeName = "session";
      el.removeAttribute("key-name");
      el.remove();

      expect(setSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
      expect(clearSpy).not.toHaveBeenCalled();
    });
  });

  describe("store-name", () => {
    beforeEach(() => {
      localStorage.setItem("prefs", JSON.stringify({ from: "local" }));
      sessionStorage.setItem("prefs", JSON.stringify({ from: "session" }));
    });

    it("defaults to localStorage", () => {
      const el = mount(`key-name="prefs"`);
      expect(el.provision).toEqual({ from: "local" });
      expect(el.storeName).toBeFalsy();
    });

    it("reads sessionStorage with store-name=\"session\"", () => {
      const el = mount(`key-name="prefs" store-name="session"`);
      expect(el).dom.to.equalTag(
        `<provider-storage is-success key-name="prefs" store-name="session"></provider-storage>`,
      );
      expect(el.provision).toEqual({ from: "session" });
    });

    it("treats an explicit store-name=\"local\" as localStorage", () => {
      const el = mount(`key-name="prefs" store-name="local"`);
      expect(el.provision).toEqual({ from: "local" });
    });

    it("re-reads from the other store when store-name changes", () => {
      const el = mount(`key-name="prefs"`);
      expect(el.provision).toEqual({ from: "local" });

      el.setAttribute("store-name", "session");
      expect(el.provision).toEqual({ from: "session" });

      el.storeName = "local";
      expect(el.provision).toEqual({ from: "local" });
    });

    it("falls back to localStorage when store-name is removed", () => {
      const el = mount(`key-name="prefs" store-name="session"`);
      expect(el.provision).toEqual({ from: "session" });

      el.removeAttribute("store-name");
      expect(el.provision).toEqual({ from: "local" });
      expect(el.isSuccess).toBe(true);
    });

    it("does not read when store-name is set without key-name", () => {
      const el = mount(`store-name="session"`);
      const spy = vi.fn();
      el.addEventListener("neutron-provision", spy);

      el.storeName = "local";

      expect(spy).not.toHaveBeenCalled();
      expect(el.isSuccess).toBeFalsy();
      expect(el.provision).toBe(null);
    });

    it("reads a missing session key as null", () => {
      const el = mount(`key-name="nope" store-name="session"`);
      expect(el.provision).toBe(null);
      expect(el.isSuccess).toBe(true);
    });
  });

  describe("errors", () => {
    it("sets is-error when the stored value is not valid JSON", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      localStorage.setItem("broken", "{not json");

      const el = mount(`key-name="broken"`);

      expect(el).dom.to.equalTag(
        `<provider-storage is-error key-name="broken"></provider-storage>`,
      );
      expect(el.isSuccess).toBe(false);
      expect(el.provision).toBe(null);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0].join(" ")).toMatch(/provider-storage/);
    });

    it("nulls the provision when a later read fails", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      localStorage.setItem("good", JSON.stringify(["a"]));
      localStorage.setItem("bad", "undefined");

      const el = mount(`key-name="good"`);
      expect(el.provision).toEqual(["a"]);

      el.keyName = "bad";
      expect(el.isError).toBe(true);
      expect(el.isSuccess).toBe(false);
      expect(el.provision).toBe(null);
    });

    it("recovers from an error when key-name moves to a valid key", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      localStorage.setItem("bad", "<html>");
      localStorage.setItem("good", "true");

      const el = mount(`key-name="bad"`);
      expect(el.isError).toBe(true);

      el.keyName = "good";
      expect(el).dom.to.equalTag(
        `<provider-storage is-success key-name="good"></provider-storage>`,
      );
      expect(el.provision).toBe(true);
    });
  });

  describe("provision", () => {
    it("publishes every read with neutron-provision", async () => {
      localStorage.setItem("prefs", JSON.stringify({ theme: "dark" }));
      const el = mount();

      await waitForEvent(el, "neutron-provision", () => {
        el.setAttribute("key-name", "prefs");
      });
      expect(el.provision).toEqual({ theme: "dark" });
    });

    it("bubbles neutron-provision to ancestors", () => {
      localStorage.setItem("prefs", "1");
      const el = mount();
      const spy = vi.fn();
      el.parentElement!.addEventListener("neutron-provision", spy);

      el.keyName = "prefs";

      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as Event).target).toBe(el);
    });
  });

  describe("storage events (other tabs)", () => {
    beforeEach(() => {
      localStorage.setItem("prefs", JSON.stringify({ theme: "dark" }));
    });

    it("re-reads and fires provider-storage-changed when another tab writes the key", () => {
      const el = mount(`key-name="prefs"`);
      const seenAtChanged: unknown[] = [];
      const changed = vi.fn(() => seenAtChanged.push(el.provision));
      const provisioned = vi.fn();
      el.addEventListener("provider-storage-changed", changed);
      el.addEventListener("neutron-provision", provisioned);

      otherTabWrites("prefs", { theme: "light" });

      expect(el.provision).toEqual({ theme: "light" });
      expect(el.isSuccess).toBe(true);
      expect(changed).toHaveBeenCalledTimes(1);
      const e = changed.mock.calls[0][0] as ProviderStorageChangedEvent;
      expect(e.detail).toEqual({
        keyName: "prefs",
        oldValue: { theme: "dark" },
        newValue: { theme: "light" },
      });
      // provision + state are already applied when the changed event fires…
      expect(seenAtChanged).toEqual([{ theme: "light" }]);
      // …and the read is still published like any other
      expect(provisioned).toHaveBeenCalledTimes(1);
    });

    it("bubbles provider-storage-changed to ancestors", () => {
      const el = mount(`key-name="prefs"`);
      const spy = vi.fn();
      el.parentElement!.addEventListener("provider-storage-changed", spy);

      otherTabWrites("prefs", 2);

      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as Event).target).toBe(el);
      expect((spy.mock.calls[0][0] as CustomEvent).detail.newValue).toBe(2);
    });

    it("reports null when another tab removes the key", () => {
      const el = mount(`key-name="prefs"`);
      const spy = vi.fn();
      el.addEventListener("provider-storage-changed", spy);

      otherTabWrites("prefs", null);

      expect(el.provision).toBe(null);
      expect(el.isSuccess).toBe(true);
      expect(spy.mock.calls[0][0].detail).toEqual({
        keyName: "prefs",
        oldValue: { theme: "dark" },
        newValue: null,
      });
    });

    it("treats a clear() in another tab (key === null) as a change", () => {
      const el = mount(`key-name="prefs"`);
      const spy = vi.fn();
      el.addEventListener("provider-storage-changed", spy);

      otherTabWrites(null, null);

      expect(el.provision).toBe(null);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].detail.newValue).toBe(null);
    });

    it("ignores writes to other keys", () => {
      const el = mount(`key-name="prefs"`);
      const changed = vi.fn();
      const provisioned = vi.fn();
      el.addEventListener("provider-storage-changed", changed);
      el.addEventListener("neutron-provision", provisioned);

      otherTabWrites("other", { x: 1 });

      expect(changed).not.toHaveBeenCalled();
      expect(provisioned).not.toHaveBeenCalled();
      expect(el.provision).toEqual({ theme: "dark" });
    });

    it("ignores writes to the same key in the other store", () => {
      sessionStorage.setItem("prefs", JSON.stringify({ from: "session" }));
      const local = mount(`key-name="prefs"`);
      const session = fixture<HTMLProviderStorageElement>(
        `<provider-storage key-name="prefs" store-name="session"></provider-storage>`,
      );
      const localSpy = vi.fn();
      const sessionSpy = vi.fn();
      local.addEventListener("provider-storage-changed", localSpy);
      session.addEventListener("provider-storage-changed", sessionSpy);

      otherTabWrites("prefs", { from: "session-2" }, sessionStorage);

      expect(localSpy).not.toHaveBeenCalled();
      expect(local.provision).toEqual({ theme: "dark" });
      expect(sessionSpy).toHaveBeenCalledTimes(1);
      expect(session.provision).toEqual({ from: "session-2" });

      otherTabWrites("prefs", { theme: "light" }, localStorage);

      expect(localSpy).toHaveBeenCalledTimes(1);
      expect(sessionSpy).toHaveBeenCalledTimes(1);
      expect(local.provision).toEqual({ theme: "light" });
    });

    it("ignores storage events while key-name is unset", () => {
      const el = mount();
      const spy = vi.fn();
      el.addEventListener("provider-storage-changed", spy);

      otherTabWrites("prefs", { theme: "light" });

      expect(spy).not.toHaveBeenCalled();
      expect(el.provision).toBe(null);
    });

    it("sets is-error and a null provision when the other tab wrote invalid JSON", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const el = mount(`key-name="prefs"`);
      const spy = vi.fn();
      el.addEventListener("provider-storage-changed", spy);

      localStorage.setItem("prefs", "{nope");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "prefs",
          oldValue: JSON.stringify({ theme: "dark" }),
          newValue: "{nope",
          storageArea: localStorage,
        }),
      );

      expect(el).dom.to.equalTag(
        `<provider-storage is-error key-name="prefs"></provider-storage>`,
      );
      expect(el.provision).toBe(null);
      expect(spy.mock.calls[0][0].detail).toEqual({
        keyName: "prefs",
        oldValue: { theme: "dark" },
        newValue: null,
      });
    });

    it("listens on window once per element while connected", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      mount(`key-name="prefs"`);
      expect(
        addSpy.mock.calls.filter(([type]) => type === "storage"),
      ).toHaveLength(1);
    });

    it("stops listening once disconnected", async () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const el = mount(`key-name="prefs"`);
      const spy = vi.fn();
      el.addEventListener("provider-storage-changed", spy);

      el.remove();
      await flushDisconnect();

      expect(
        removeSpy.mock.calls.filter(([type]) => type === "storage"),
      ).toHaveLength(1);

      otherTabWrites("prefs", { theme: "light" });
      expect(spy).not.toHaveBeenCalled();
      expect(el.provision).toEqual({ theme: "dark" });
    });

    it("keeps listening across a synchronous move", async () => {
      const el = mount(`key-name="prefs"`);
      const spy = vi.fn();
      el.addEventListener("provider-storage-changed", spy);
      const newParent = document.createElement("section");
      document.body.append(newParent);

      newParent.append(el); // disconnect + connect in the same tick
      await flushDisconnect();

      otherTabWrites("prefs", { theme: "light" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(el.provision).toEqual({ theme: "light" });

      // and only once, no duplicate listener after the move
      otherTabWrites("prefs", { theme: "dark" });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("listens again after a later re-insert", async () => {
      const el = mount(`key-name="prefs"`);
      const spy = vi.fn();
      el.addEventListener("provider-storage-changed", spy);

      el.remove();
      await flushDisconnect();
      document.body.append(el);

      otherTabWrites("prefs", { theme: "light" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(el.provision).toEqual({ theme: "light" });
    });
  });
});
