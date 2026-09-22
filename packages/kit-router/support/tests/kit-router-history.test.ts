import { KitRoute, KitRouter, kitRouter } from "../../index";
import { KitLogger } from "@excom/kit-logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const SESSION_KEY = "__spa_router_data__";

const popstate = (id: string | null, hasUAVisualTransition?: boolean) => {
  if (id !== null) {
    // happy-dom keeps the pushed state object; mutate the id to emulate
    // the browser moving through history.
    (history.state as { id: string }).id = id;
  }
  const e = new PopStateEvent("popstate");
  if (hasUAVisualTransition !== undefined) {
    Object.defineProperty(e, "hasUAVisualTransition", {
      value: hasUAVisualTransition,
    });
  }
  window.dispatchEvent(e);
};

const statesOf = (router: KitRouter) =>
  (router as unknown as { states: Array<{ id: string; url: string }> }).states;

describe("KitRoute params", () => {
  it("returns empty params when a param cannot be decoded", () => {
    const route = new KitRoute("/u/:name", () => {});
    // malformed percent-encoding makes decodeURIComponent throw
    const result = route.match("/u/%E0%A4%A");
    expect(result.match).not.toBeNull();
    expect(result.params).toEqual({});
  });

  it("supports wildcards", () => {
    const route = new KitRoute("/files/*", () => {});
    expect(route.match("/files/a/b/c.txt").match).not.toBeNull();
    expect(route.match("/files/").match).not.toBeNull();
    expect(route.match("/other").match).toBeNull();
  });

  it("does not match nested paths without a trailing segment", () => {
    const route = new KitRoute("/settings", () => {}, { matchNested: true });
    expect(route.match("/settingsx").match).toBeNull();
    expect(route.match("/settings/").match).not.toBeNull();
  });
});

describe("KitRouter history", () => {
  let router: KitRouter;

  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  afterEach(() => {
    router?.destroy();
    vi.restoreAllMocks();
    sessionStorage.removeItem(SESSION_KEY);
    window.scrollTo(0, 0);
    history.replaceState(null, "", "/");
  });

  it("exports a singleton router", () => {
    expect(kitRouter).toBeInstanceOf(KitRouter);
  });

  it("handles popstate back / forward / same-entry moves", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/.*/, handler));
    router.pushState({ url: "/p1" });
    router.pushState({ url: "/p2" });
    const states = statesOf(router);
    expect(states.map((s) => s.url)).toEqual(["/", "/p1", "/p2"]);
    handler.mockClear();

    // back to /p1
    popstate(states[1].id, false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        move: "back",
        event: { hasUAVisualTransition: false },
        previous: expect.objectContaining({ url: "/" }),
        active: expect.objectContaining({ url: "/p1" }),
        next: expect.objectContaining({ url: "/p2" }),
      })
    );
    expect(router.canGoForward()).toBe(true);
    expect(router.canGoBack()).toBe(true);

    // forward to /p2
    popstate(states[2].id, true);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        move: "forward",
        event: { hasUAVisualTransition: true },
        active: expect.objectContaining({ url: "/p2" }),
        next: null,
      })
    );
    expect(router.canGoForward()).toBe(false);

    // popstate on the same entry keeps the last move
    popstate(states[2].id);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({ move: "forward" })
    );
  });

  it("treats popstate as back when no state id has been tracked yet", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/.*/, handler));
    handler.mockClear();

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        move: "back",
        event: { hasUAVisualTransition: false },
        previous: null,
        next: null,
      })
    );
  });

  it("stores the scroll position of the outgoing state on push and on popstate", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/.*/, handler));
    router.pushState({ url: "/first" });
    handler.mockClear();

    window.scrollTo(10, 100);
    router.pushState({ url: "/second" });
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previous: expect.objectContaining({
          url: "/first",
          scrollX: 10,
          scrollY: 100,
        }),
      })
    );

    window.scrollTo(3, 7);
    const states = statesOf(router);
    popstate(states[1].id);
    expect(states[2]).toEqual(
      expect.objectContaining({ url: "/second", scrollX: 3, scrollY: 7 })
    );
    window.scrollTo(0, 0);
    router.pushState({ url: "/third" });
    // zero offsets are not stored
    expect(states[1]).toEqual(
      expect.objectContaining({ scrollX: 10, scrollY: 100 })
    );
  });

  it("drops forward states when pushing after going back", () => {
    router = new KitRouter();
    router.on(new KitRoute(/.*/, () => {}));
    router.pushState({ url: "/a" });
    router.pushState({ url: "/b" });
    popstate(statesOf(router)[1].id);
    router.pushState({ url: "/c" });
    expect(statesOf(router).map((s) => s.url)).toEqual(["/", "/a", "/c"]);
    expect(router.canGoForward()).toBe(false);
  });

  it("keeps state metadata (title, scroll, transition types)", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/.*/, handler));
    router.pushState({
      url: "/meta",
      title: "Meta",
      scrollX: 3,
      scrollY: 7,
      ttypes: ["fade"],
    });
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: expect.objectContaining({
          url: "/meta",
          title: "Meta",
          scrollX: 3,
          scrollY: 7,
          ttypes: ["fade"],
        }),
      })
    );
    router.replaceState({ url: "/meta-2", ttypes: [] });
    const active = handler.mock.lastCall![0].active;
    expect(active.url).toBe("/meta-2");
    expect(active).not.toHaveProperty("ttypes");
    expect(active).not.toHaveProperty("title");
  });

  it("canGoBack is true after a push and when the oldest state is not initial", () => {
    router = new KitRouter();
    router.on(new KitRoute(/.*/, () => {}));
    expect(router.canGoBack()).toBe(false);
    router.pushState({ url: "/x" });
    expect(router.canGoBack()).toBe(true);

    // exceeding MAX_STATES drops the initial state; back is still possible
    router.MAX_STATES = 1;
    router.pushState({ url: "/y" });
    expect(statesOf(router).map((s) => s.url)).toEqual(["/y"]);
    expect(router.canGoBack()).toBe(true);
  });

  it("back / forward delegate to history.go", () => {
    router = new KitRouter();
    const goSpy = vi.spyOn(history, "go").mockImplementation(() => {});
    router.back();
    expect(goSpy).toHaveBeenLastCalledWith(-1);
    router.back(-2);
    expect(goSpy).toHaveBeenLastCalledWith(-2);
    router.forward();
    expect(goSpy).toHaveBeenLastCalledWith(1);
    router.forward(3);
    expect(goSpy).toHaveBeenLastCalledWith(3);
  });

  describe("trailing slash", () => {
    it("strips a trailing slash when no route wants it", () => {
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute(/.*/, handler));
      router.on(new KitRoute("/foo", () => {}));
      handler.mockClear();
      router.pushState({ url: "/foo/?q=1#h" });
      expect(location.pathname).toBe("/foo");
      expect(location.search).toBe("?q=1");
      expect(location.hash).toBe("#h");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({ move: "push" })
      );
    });

    it("strips a trailing slash when only a trailing-slash string route matches", () => {
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute("/bar/", handler));
      handler.mockClear();
      router.pushState({ url: "/bar/" });
      expect(location.pathname).toBe("/bar");
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({ match: null })
      );
    });

    it("keeps a trailing slash when a nested string route matches it", () => {
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute("/baz", handler, { matchNested: true }));
      handler.mockClear();
      router.pushState({ url: "/baz/" });
      expect(location.pathname).toBe("/baz/");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.lastCall![0].match).not.toBeNull();
    });

    it("never strips the root path", () => {
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute("/", handler));
      handler.mockClear();
      router.pushState({ url: "/" });
      expect(location.pathname).toBe("/");
      expect(handler.mock.lastCall![0].match).not.toBeNull();
    });
  });

  describe("session storage", () => {
    it("persists router data and restores it in a new router", async () => {
      router = new KitRouter();
      router.pushState({ url: "/persisted" });
      await wait(5);
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY)!);
      expect(stored.states.map((s) => s.url)).toEqual(["/", "/persisted"]);
      expect(stored.currentTempData.move).toBe("push");

      const restored = new KitRouter();
      try {
        expect(statesOf(restored).map((s) => s.url)).toEqual([
          "/",
          "/persisted",
        ]);
      } finally {
        restored.destroy();
      }
    });

    it("falls back to a fresh state when stored data is unreadable", () => {
      const errorSpy = vi
        .spyOn(KitLogger, "error")
        .mockImplementation(() => {});
      sessionStorage.setItem(SESSION_KEY, "{not json");
      router = new KitRouter();
      expect(errorSpy).toHaveBeenCalledWith(
        "Error getting session data",
        expect.anything()
      );
      const states = statesOf(router);
      expect(states).toHaveLength(1);
      expect(states[0]).toEqual(expect.objectContaining({ isInit: true }));
    });

    it("logs when session data cannot be written", async () => {
      router = new KitRouter();
      const errorSpy = vi
        .spyOn(KitLogger, "error")
        .mockImplementation(() => {});
      const setItemSpy = vi
        .spyOn(sessionStorage, "setItem")
        .mockImplementation(() => {
          throw new Error("quota");
        });
      router.pushState({ url: "/unwritable" });
      await wait(5);
      setItemSpy.mockRestore();
      expect(errorSpy).toHaveBeenCalledWith(
        "Error setting session data",
        expect.any(Error)
      );
    });
  });
});
