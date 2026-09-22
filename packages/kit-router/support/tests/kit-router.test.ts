import { KitRoute, KitRouter } from "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

describe("KitRoute", () => {
  it("matches routes with params", () => {
    const route = new KitRoute("/users/:id", () => {});
    const match = route.match("/users/123");
    expect(match?.params).toEqual({ id: "123" });
  });

  it("supports nested matches when enabled", () => {
    const route = new KitRoute("/settings", () => {}, { matchNested: true });
    const match = route.match("/settings/profile");
    expect(match.match).not.toBeNull();
  });

  it("does not match non-nested paths by default", () => {
    const route = new KitRoute("/settings", () => {});
    const result = route.match("/settings/profile");
    expect(result.match).toBeNull();
  });

  it("matches exact path", () => {
    const route = new KitRoute("/about", () => {});
    const result = route.match("/about");
    expect(result.match).not.toBeNull();
    expect(result.params).toEqual({});
  });

  it("extracts multiple params", () => {
    const route = new KitRoute("/users/:userId/posts/:postId", () => {});
    const result = route.match("/users/42/posts/99");
    expect(result.params).toEqual({ userId: "42", postId: "99" });
  });

  it("decodes URI-encoded params", () => {
    const route = new KitRoute("/search/:query", () => {});
    const result = route.match("/search/hello%20world");
    expect(result.params).toEqual({ query: "hello world" });
  });

  it("returns null params for non-matching route", () => {
    const route = new KitRoute("/users/:id", () => {});
    const result = route.match("/posts/123");
    expect(result.match).toBeNull();
    expect(result.params).toBeNull();
  });

  it("works with regex keys", () => {
    const route = new KitRoute(/^\/api\/(.+)$/, () => {});
    const result = route.match("/api/v1/users");
    expect(result.match).not.toBeNull();
    expect(result.match![1]).toBe("v1/users");
  });

  it("throws for invalid route or handler", () => {
    expect(() => new KitRoute("", () => {})).toThrow("Invalid route");
    expect(() => new KitRoute("/path", null as any)).toThrow(
      "Invalid route",
    );
  });

  it("throws for invalid key type", () => {
    expect(() => new KitRoute(123 as any, () => {})).toThrow(
      "Invalid route key type",
    );
  });

  it("matches root path", () => {
    const route = new KitRoute("/", () => {});
    const result = route.match("/");
    expect(result.match).not.toBeNull();
  });
});

describe("KitRouter", () => {
  let router: KitRouter;

  afterEach(() => {
    router?.destroy();
    vi.restoreAllMocks();
    sessionStorage.removeItem("__spa_router_data__");
  });

  it("registers a route and immediately calls its handler", () => {
    router = new KitRouter();
    const handler = vi.fn();
    const route = new KitRoute(/.*/, handler);
    router.on(route);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        active: expect.any(Object),
        match: expect.any(Array),
      }),
    );
  });

  it("throws when registering a duplicate route", () => {
    router = new KitRouter();
    const handler = vi.fn();
    const route = new KitRoute(/.*/, handler);
    router.on(route);
    expect(() => router.on(route)).toThrow("Route already registered");
  });

  it("unregisters a route with off()", () => {
    router = new KitRouter();
    const handler = vi.fn();
    const route = new KitRoute(/.*/, handler);
    router.on(route);
    expect(handler).toHaveBeenCalledTimes(1);
    router.off(route);
    router.pushState({ url: "/test-off" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("pushState calls matching handlers", () => {
    router = new KitRouter();
    const handler = vi.fn();
    const route = new KitRoute(/.*/, handler);
    router.on(route);
    handler.mockClear();

    router.pushState({ url: "/new-page" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ move: "push" }),
    );
  });

  it("replaceState calls matching handlers", () => {
    router = new KitRouter();
    const handler = vi.fn();
    const route = new KitRoute(/.*/, handler);
    router.on(route);
    handler.mockClear();

    router.replaceState({ url: "/replaced" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ move: "replace" }),
    );
  });

  it("canGoBack returns false on initial state", () => {
    router = new KitRouter();
    expect(router.canGoBack()).toBe(false);
  });

  it("canGoForward returns false with no forward states", () => {
    router = new KitRouter();
    expect(router.canGoForward()).toBe(false);
  });

  it("provides previous/active/next state to handlers", () => {
    router = new KitRouter();
    const handler = vi.fn();
    const route = new KitRoute(/.*/, handler);
    router.on(route);
    handler.mockClear();

    router.pushState({ url: "/page1" });
    const data = handler.mock.calls[0][0];
    expect(data.previous).not.toBeNull();
    expect(data.active).toBeDefined();
    expect(data.active.url).toBe("/page1");
    expect(data.next).toBeNull();
  });

  it("passes route params to handler", () => {
    router = new KitRouter();
    const handler = vi.fn();
    const route = new KitRoute("/items/:id", handler);
    router.on(route);
    handler.mockClear();

    history.replaceState({}, "", "/items/42");
    router.pushState({ url: "/items/42" });
    const data = handler.mock.calls[0][0];
    expect(data.params).toEqual({ id: "42" });
  });

  it("stores title in state when provided", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/.*/, handler));
    handler.mockClear();

    router.pushState({ url: "/titled", title: "My Page" });
    const data = handler.mock.calls[0][0];
    expect(data.active.title).toBe("My Page");
  });
});
