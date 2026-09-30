import { KitRoute, type KitRouteData, KitRouter, kitRouter } from "../../index";
import { KitLogger } from "@excom/kit-logger";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const SESSION_KEY = "__kit_router_history__";

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

  // The module singleton would adopt the test routers' entries on popstate
  beforeAll(() => kitRouter.destroy());

  beforeEach(() => {
    sessionStorage.removeItem(SESSION_KEY);
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

  it("adopts a popstate entry it did not create (fragment link), with no move", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/.*/, handler));
    router.pushState({ url: "/p1" });
    router.pushState({ url: "/p2" });
    popstate(statesOf(router)[1].id);
    handler.mockClear();

    // the browser adds a state-less entry after /p1 and drops /p2
    history.pushState(null, "", "/p1#frag");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const states = statesOf(router);
    expect(states.map((s) => s.url)).toEqual(["/", "/p1", "/p1#frag"]);
    expect(history.state.id).toBe(states[2].id);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        move: null,
        previous: expect.objectContaining({ url: "/p1" }),
        active: states[2],
        next: null,
      })
    );
    expect(router.canGoBack()).toBe(true);
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
    // back at the top: zero offsets are stored too
    expect(states[1]).toEqual(
      expect.objectContaining({ scrollX: 0, scrollY: 0 })
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

  it("previousStates / nextStates split the states around the active entry", () => {
    router = new KitRouter();
    router.on(new KitRoute(/.*/, () => {}));
    const urls = (states: Array<{ url: string }>) => states.map((s) => s.url);
    expect(router.previousStates).toEqual([]);
    expect(router.nextStates).toEqual([]);

    router.pushState({ url: "/a" });
    router.pushState({ url: "/b" });
    expect(urls(router.previousStates)).toEqual(["/", "/a"]);
    expect(router.nextStates).toEqual([]);

    const states = statesOf(router);
    popstate(states[1].id);
    expect(urls(router.previousStates)).toEqual(["/"]);
    expect(urls(router.nextStates)).toEqual(["/b"]);

    popstate(states[0].id);
    expect(router.previousStates).toEqual([]);
    expect(urls(router.nextStates)).toEqual(["/a", "/b"]);

    // copies: mutating them does not touch the router
    router.nextStates.pop();
    expect(statesOf(router)).toHaveLength(3);
  });

  it("previousStates / nextStates use the current entry when a foreign replace drops the id", () => {
    router = new KitRouter();
    router.on(new KitRoute(/.*/, () => {}));
    router.pushState({ url: "/a" });
    history.replaceState({ id: "unknown" }, "");
    expect(router.previousStates.map((s) => s.url)).toEqual(["/"]);
    expect(router.nextStates).toEqual([]);
    expect(router.canGoBack()).toBe(true);
    expect(router.canGoForward()).toBe(false);
  });

  it("stamps the id back after a foreign replaceState, adding no entry", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/.*/, handler));
    // e.g. a login redirect or tracking-parameter cleanup
    history.replaceState({}, "", "/clean");
    router.pushState({ url: "/b" });
    const states = statesOf(router);
    expect(states.map((s) => s.url)).toEqual(["/clean", "/b"]);

    popstate(states[0].id);
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({ move: "back", active: states[0] })
    );
    expect(router.canGoBack()).toBe(false);
  });

  it("saves the offset into the current entry on pagehide after a foreign replace", () => {
    router = new KitRouter();
    router.pushState({ url: "/a" });
    history.replaceState({}, "", "/a2");
    window.scrollTo(0, 80);
    window.dispatchEvent(new Event("pagehide"));
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY)!);
    expect(stored.states).toHaveLength(2);
    expect(stored.states[1]).toEqual(
      expect.objectContaining({ scrollX: 0, scrollY: 80 })
    );
  });

  it("saves no offset on pagehide without a known or current entry", () => {
    router = new KitRouter();
    router.pushState({ url: "/a" });
    (router as unknown as { currentStateId: string }).currentStateId = "gone";
    history.replaceState({ id: "unknown" }, "");
    const before = JSON.stringify(statesOf(router));
    window.scrollTo(0, 80);
    expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
    expect(JSON.stringify(statesOf(router))).toBe(before);
  });

  it("writes no offset on a popstate that stays on the same entry", () => {
    router = new KitRouter();
    router.pushState({ url: "/a" });
    window.scrollTo(0, 30);
    router.pushState({ url: "/b" });
    const states = statesOf(router);
    popstate(states[1].id);
    window.scrollTo(0, 999);
    popstate(states[1].id);
    expect(states[1].scrollY).toBe(30);
  });

  it("saves the offset of an entry left through a fragment link", () => {
    router = new KitRouter();
    router.pushState({ url: "/p1" });
    window.scrollTo(0, 250);
    history.pushState(null, "", "/p1#frag");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const states = statesOf(router);
    expect(states.map((s) => s.url)).toEqual(["/", "/p1", "/p1#frag"]);
    expect(states[1]).toEqual(
      expect.objectContaining({ scrollX: 0, scrollY: 250 })
    );
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

  describe("entries", () => {
    it("gives every entry its own id, also for a repeated URL", () => {
      router = new KitRouter();
      router.pushState({ url: "/same" });
      router.pushState({ url: "/same" });
      const ids = statesOf(router).map((s) => s.id);
      expect(new Set(ids).size).toBe(3);
      expect(history.state.id).toBe(ids[2]);
    });

    it("makes unique ids without crypto.randomUUID (insecure context)", () => {
      vi.stubGlobal("crypto", {});
      try {
        router = new KitRouter();
        router.pushState({ url: "/x" });
        router.pushState({ url: "/x" });
        const ids = statesOf(router).map((s) => s.id);
        expect(ids.every((id) => typeof id === "string" && id)).toBe(true);
        expect(new Set(ids).size).toBe(3);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("stamps the cold-load entry with its id, keeping other state", () => {
      history.replaceState({ foreign: 1 }, "", "/cold");
      router = new KitRouter();
      const [state] = statesOf(router);
      expect(state).toEqual(
        expect.objectContaining({ url: "/cold", isInit: true })
      );
      expect(history.state).toEqual({ foreign: 1, id: state.id });
    });

    it("keeps each visit to one URL apart: own offset, own move", () => {
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute(/.*/, handler));
      router.pushState({ url: "/x" });
      window.scrollTo(0, 100);
      router.pushState({ url: "/y" });
      window.scrollTo(0, 200);
      router.pushState({ url: "/x" });
      window.scrollTo(0, 300);
      const states = statesOf(router);

      popstate(states[2].id);
      expect(states[3].scrollY).toBe(300);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({ move: "back", active: states[2] })
      );
      window.scrollTo(0, 200);
      popstate(states[1].id);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({
          move: "back",
          active: expect.objectContaining({ url: "/x", scrollY: 100 }),
        })
      );
      window.scrollTo(0, 100);
      popstate(states[3].id);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({
          move: "forward",
          active: expect.objectContaining({ url: "/x", scrollY: 300 }),
        })
      );
    });

    it("reports back after a link to the current page, saving its offset", () => {
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute(/.*/, handler));
      router.pushState({ url: "/a" });
      window.scrollTo(0, 50);
      router.pushState({ url: "/a" });
      window.scrollTo(0, 70);
      const states = statesOf(router);

      popstate(states[1].id);
      expect(states[2].scrollY).toBe(70);
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({
          move: "back",
          active: expect.objectContaining({ scrollY: 50 }),
          next: states[2],
        })
      );
    });

    it("truncates at the active entry when pushing after back to a repeated URL", () => {
      router = new KitRouter();
      router.pushState({ url: "/a" });
      router.pushState({ url: "/b" });
      router.pushState({ url: "/a" });
      popstate(statesOf(router)[1].id);
      router.pushState({ url: "/c" });
      expect(statesOf(router).map((s) => s.url)).toEqual(["/", "/a", "/c"]);
    });

    it("keeps canGoBack() false after a first-move replace", () => {
      router = new KitRouter();
      router.replaceState({ url: "/r" });
      expect(statesOf(router)).toEqual([
        expect.objectContaining({ url: "/r", isInit: true }),
      ]);
      expect(router.canGoBack()).toBe(false);
    });

    it("keeps forward states when replacing after back", () => {
      router = new KitRouter();
      router.pushState({ url: "/a" });
      router.pushState({ url: "/b" });
      popstate(statesOf(router)[1].id);
      router.replaceState({ url: "/a2" });
      expect(statesOf(router).map((s) => s.url)).toEqual(["/", "/a2", "/b"]);
      expect(router.canGoForward()).toBe(true);
    });

    it("passes the query to handlers", () => {
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute("/p", handler));
      router.pushState({ url: "/p?page=2&q=a%20b#h" });
      expect(handler).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: { page: "2", q: "a b" } })
      );
    });

    it("pushes a relative url resolved against <base>", () => {
      const base = document.head.appendChild(
        Object.assign(document.createElement("base"), { href: "/shop/" })
      );
      try {
        router = new KitRouter();
        const handler = vi.fn();
        router.on(new KitRoute("checkout", handler));
        router.pushState({ url: "checkout?step=2#top" });
        expect(location.pathname + location.search + location.hash).toBe(
          "/shop/checkout?step=2#top"
        );
        expect(handler).toHaveBeenLastCalledWith(
          expect.objectContaining({
            match: expect.arrayContaining(["/shop/checkout"]),
            active: expect.objectContaining({
              url: "/shop/checkout?step=2#top",
            }),
          })
        );
        // absolute paths ignore <base>
        router.replaceState({ url: "/abs" });
        expect(location.pathname).toBe("/abs");
      } finally {
        base.remove();
      }
    });

    it("saves the active offset on pagehide and writes the session at once", () => {
      router = new KitRouter();
      router.pushState({ url: "/a" });
      window.scrollTo(5, 60);
      window.dispatchEvent(new Event("pagehide"));
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY)!);
      expect(stored.states[1]).toEqual(
        expect.objectContaining({ url: "/a", scrollX: 5, scrollY: 60 })
      );
    });
  });

  describe("page loads", () => {
    /** A new document on the current entry; `enter` moves history first. */
    const load = (enter?: () => void) => {
      window.dispatchEvent(new Event("pagehide"));
      router.destroy();
      enter?.();
      router = new KitRouter();
      const handler = vi.fn();
      router.on(new KitRoute(/.*/, handler));
      return handler.mock.lastCall![0] as KitRouteData;
    };

    it("keeps its entry on reload, with no move and the saved offset", () => {
      router = new KitRouter();
      router.pushState({ url: "/a" });
      router.pushState({ url: "/b" });
      window.scrollTo(0, 120);
      const ids = statesOf(router).map((s) => s.id);

      const data = load();
      expect(statesOf(router).map((s) => s.id)).toEqual(ids);
      expect(data).toEqual(
        expect.objectContaining({
          move: null,
          previous: expect.objectContaining({ url: "/a" }),
          active: expect.objectContaining({
            url: "/b",
            scrollX: 0,
            scrollY: 120,
          }),
          next: null,
        })
      );
    });

    it("reports back / forward from another document, with the saved offset", () => {
      router = new KitRouter();
      router.pushState({ url: "/a" });
      window.scrollTo(0, 40);
      router.pushState({ url: "/b" });
      window.scrollTo(0, 90);
      const [, a, b] = statesOf(router);

      const back = load(() => history.replaceState({ id: a.id }, "", "/a"));
      expect(back).toEqual(
        expect.objectContaining({
          move: "back",
          active: expect.objectContaining({ id: a.id, scrollY: 40 }),
          next: expect.objectContaining({ id: b.id, scrollY: 90 }),
        })
      );

      window.scrollTo(0, 40);
      const forward = load(() => history.replaceState({ id: b.id }, "", "/b"));
      expect(forward).toEqual(
        expect.objectContaining({
          move: "forward",
          active: expect.objectContaining({ id: b.id, scrollY: 90 }),
        })
      );
    });

    it("adds a typed URL after the stored current entry, with no move", () => {
      router = new KitRouter();
      router.pushState({ url: "/a" });
      router.pushState({ url: "/b" });
      // back on /a: /b is forward, and the browser drops it
      popstate(statesOf(router)[1].id);

      const data = load(() => history.pushState(null, "", "/typed?q=1"));
      expect(statesOf(router).map((s) => s.url)).toEqual([
        "/",
        "/a",
        "/typed?q=1",
      ]);
      expect(data).toEqual(
        expect.objectContaining({
          move: null,
          previous: expect.objectContaining({ url: "/a" }),
          active: expect.objectContaining({ url: "/typed?q=1", isInit: true }),
          next: null,
        })
      );
      expect(data.active).not.toHaveProperty("scrollY");
      expect(history.state.id).toBe(data.active.id);
      expect(router.canGoBack()).toBe(true);

      // the first push keeps the earlier states
      router.pushState({ url: "/c" });
      expect(statesOf(router).map((s) => s.url)).toEqual([
        "/",
        "/a",
        "/typed?q=1",
        "/c",
      ]);
    });

    it("treats an unknown history id like a new entry", () => {
      router = new KitRouter();
      router.pushState({ url: "/a" });
      const data = load(() => history.replaceState({ id: "gone" }, "", "/x"));
      expect(statesOf(router).map((s) => s.url)).toEqual(["/", "/a", "/x"]);
      expect(data.move).toBeNull();
      expect(data.active.url).toBe("/x");
      expect(history.state.id).toBe(data.active.id);
    });
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
      expect(stored.currentStateId).toBe(statesOf(router)[1].id);

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

    it("ignores a session left by 0.1.3 (old key, content-hash ids)", () => {
      const old = "__spa_router_data__";
      sessionStorage.setItem(
        old,
        JSON.stringify({
          states: [
            { id: "h0", url: "/", isInit: true },
            { id: "h1", url: "/b" },
          ],
          currentStateId: "h1",
          currentTempData: { move: "push" },
        })
      );
      history.replaceState({ id: "h1" }, "", "/b");
      try {
        router = new KitRouter();
        const handler = vi.fn();
        router.on(new KitRoute(/.*/, handler));
        const states = statesOf(router);
        expect(states).toEqual([
          expect.objectContaining({ url: "/b", isInit: true }),
        ]);
        expect(states[0].id).not.toBe("h1");
        expect(handler).toHaveBeenLastCalledWith(
          expect.objectContaining({ move: null, previous: null })
        );
      } finally {
        sessionStorage.removeItem(old);
      }
    });

    it("uses the plain key in the top-level page", () => {
      router = new KitRouter();
      window.dispatchEvent(new Event("pagehide"));
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY)!);
      expect(stored.states).toEqual([expect.objectContaining({ url: "/" })]);
    });

    it("keeps a router inside a frame off the page's key", () => {
      const page = JSON.stringify({
        states: [{ id: "p", url: "/page", scrollY: 300 }],
        currentStateId: "p",
      });
      const frameKey = `${SESSION_KEY}:/sandbox/todo-app`;
      sessionStorage.setItem(SESSION_KEY, page);
      history.replaceState({ id: "p" }, "", "/sandbox/todo-app");
      // stand-in for `window !== window.top`
      vi.stubGlobal("top", {});
      try {
        router = new KitRouter();
        expect(statesOf(router)).toEqual([
          expect.objectContaining({ url: "/sandbox/todo-app", isInit: true }),
        ]);
        router.pushState({ url: "/sandbox/todo-app/2" });
        window.dispatchEvent(new Event("pagehide"));
        expect(sessionStorage.getItem(SESSION_KEY)).toBe(page);
        expect(
          JSON.parse(sessionStorage.getItem(frameKey)!).states
        ).toHaveLength(2);
      } finally {
        vi.unstubAllGlobals();
        sessionStorage.removeItem(frameKey);
      }
    });

    it("starts fresh when a stored state has no id", () => {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ states: [null, { url: "/x" }], currentStateId: "a" })
      );
      expect(() => (router = new KitRouter())).not.toThrow();
      expect(statesOf(router)).toEqual([
        expect.objectContaining({ url: "/", isInit: true }),
      ]);
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
