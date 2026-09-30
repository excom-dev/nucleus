import { KitRoute, KitRouter, resolveHref } from "../../index";
import {
  afterEach,
  beforeEach,
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

  it("matches the base path and child paths with match-nested", () => {
    const route = new KitRoute("/checkout", () => {}, { matchNested: true });
    const base = (path: string) => route.match(path).match?.[0] ?? null;
    expect(base("/checkout")).toBe("/checkout");
    expect(base("/checkout/")).toBe("/checkout");
    expect(base("/checkout/shipping")).toBe("/checkout");
    expect(base("/checkoutx")).toBeNull();
    expect(base("/other/checkout")).toBeNull();
  });

  it("matches every path from the root with match-nested", () => {
    const route = new KitRoute("/", () => {}, { matchNested: true });
    for (const path of ["/", "/a", "/a/b/"]) {
      expect(route.match(path).match?.[0]).toBe("/");
    }
  });

  it("keeps params of a nested pattern", () => {
    const route = new KitRoute("/users/:id", () => {}, { matchNested: true });
    expect(route.match("/users/7").params).toEqual({ id: "7" });
    expect(route.match("/users/7/edit").params).toEqual({ id: "7" });
    expect(route.match("/users").match).toBeNull();
  });
});

describe("resolveHref", () => {
  let base: HTMLBaseElement;
  beforeEach(() => {
    base = document.head.appendChild(
      Object.assign(document.createElement("base"), { href: "/shop/" })
    );
  });
  afterEach(() => base.remove());

  it("resolves a relative href against <base>", () => {
    expect(resolveHref("checkout")).toBe("/shop/checkout");
    expect(resolveHref("./a/b?x=1#h")).toBe("/shop/a/b?x=1#h");
    expect(resolveHref("../up")).toBe("/up");
  });

  it("keeps the resolved path encoded, so pushing it never throws", () => {
    expect(resolveHref("café")).toBe("/shop/caf%C3%A9");
    expect(resolveHref("a%25b")).toBe("/shop/a%25b");
    expect(resolveHref("100%")).toBe("/shop/100%");
  });

  it("decodes the pattern like the pathname it matches", () => {
    const match = (href: string, path: string) =>
      new KitRoute(href, () => {}).match(path).match;
    expect(match("café", "/shop/café")).not.toBeNull();
    expect(match("a%25b", "/shop/a%b")).not.toBeNull();
    // a bare `%` cannot be decoded: kept as is
    expect(match("100%", "/shop/100%")).not.toBeNull();
  });

  it("passes absolute paths and full URLs through", () => {
    expect(resolveHref("/checkout")).toBe("/checkout");
    expect(resolveHref("https://example.test/x")).toBe(
      "https://example.test/x"
    );
  });

  it("builds a route pattern from a relative href", () => {
    const route = new KitRoute("checkout/:step", () => {});
    expect(route.match("/shop/checkout/shipping").params).toEqual({
      step: "shipping",
    });
    expect(route.match("/checkout/shipping").match).toBeNull();
  });
});

describe("KitRoute regex params", () => {
  const matchOf = (regex: RegExp, path: string) =>
    new KitRoute(regex, () => {}).match(path);

  it("takes one named group as a param", () => {
    const { params } = matchOf(/^\/users\/(?<id>\d+)$/, "/users/42");
    expect(params).toStrictEqual({ id: "42" });
  });

  it("takes every named group as a param", () => {
    const { params } = matchOf(
      /^\/(?<year>\d{4})\/(?<slug>[^/]+)$/,
      "/2026/hello"
    );
    expect(params).toStrictEqual({ year: "2026", slug: "hello" });
  });

  it("decodes named group values like path params", () => {
    const { params } = matchOf(/^\/search\/(?<query>.+)$/, "/search/a%20b");
    expect(params).toStrictEqual({ query: "a b" });
  });

  it("leaves unnamed groups out of the params, in the match", () => {
    const { match, params } = matchOf(
      /^\/(?<lang>en|de)\/docs\/(.+)$/,
      "/en/docs/intro"
    );
    expect(params).toStrictEqual({ lang: "en" });
    expect(match?.[2]).toBe("intro");
  });

  it("has no params for unnamed groups only", () => {
    const { match, params } = matchOf(/^\/(\w+)\/(\d+)$/, "/posts/7");
    expect(params).toStrictEqual({});
    expect(match?.slice(1)).toEqual(["posts", "7"]);
  });

  it("leaves out a named group that did not match", () => {
    const regex = /^\/blog(?:\/(?<page>\d+))?$/;
    expect(matchOf(regex, "/blog").params).toStrictEqual({});
    expect(matchOf(regex, "/blog/2").params).toStrictEqual({ page: "2" });
  });

  it("still takes path pattern params by name", () => {
    const route = new KitRoute("/users/:id/posts/:postId", () => {});
    expect(route.match("/users/7/posts/9").params).toStrictEqual({
      id: "7",
      postId: "9",
    });
  });

  it("matches a g-flagged key like one without", () => {
    const key = /^\/users\/(?<id>\d+)$/g;
    const route = new KitRoute(key, () => {});
    const { match, params } = route.match("/users/42");
    expect(params).toStrictEqual({ id: "42" });
    expect(match?.[1]).toBe("42");
    expect(route.match("/users/43").params).toStrictEqual({ id: "43" });
    expect(key.lastIndex).toBe(0);
  });

  it("does not depend on lastIndex for a y-flagged key", () => {
    const key = /^\/users\/(?<id>\d+)$/y;
    const route = new KitRoute(key, () => {});
    expect(route.match("/users/1").params).toStrictEqual({ id: "1" });
    expect(route.match("/users/2").params).toStrictEqual({ id: "2" });
    expect(key.lastIndex).toBe(0);
  });

  it("keeps the other flags of a g / y key", () => {
    const route = new KitRoute(/^\/Users\/(?<id>\d+)$/gimy, () => {});
    expect(route.match("/users/5").params).toStrictEqual({ id: "5" });
    expect(route.regex.flags).toBe("im");
  });
});

describe("KitRoute path pattern params", () => {
  const paramsOf = (
    pattern: string,
    path: string,
    opts?: { matchNested?: boolean }
  ) => new KitRoute(pattern, () => {}, opts).match(path).params;

  it("ignores a capture group before a placeholder", () => {
    const route = new KitRoute("/(a|b)/:id", () => {});
    const { match, params } = route.match("/a/5");
    expect(params).toStrictEqual({ id: "5" });
    expect(match?.[1]).toBe("a");
  });

  it("ignores a capture group between and after placeholders", () => {
    expect(
      paramsOf("/:kind/(x|y)/:id/(edit)?", "/post/y/9/edit")
    ).toStrictEqual({ kind: "post", id: "9" });
  });

  it("takes no placeholder from a non-capturing group", () => {
    expect(paramsOf("/(?:a|b)/:id", "/a/5")).toStrictEqual({ id: "5" });
    expect(paramsOf("/(?:admin|staff)/:id", "/staff/7")).toStrictEqual({
      id: "7",
    });
  });

  it("keeps params behind a lookahead", () => {
    const route = new KitRoute("/docs/(?!introduction$):name", () => {});
    expect(route.match("/docs/quick_start").params).toStrictEqual({
      name: "quick_start",
    });
    expect(route.match("/docs/introduction").match).toBeNull();
  });

  it("takes a group the author named under its own name", () => {
    expect(paramsOf("/(?<lang>en|de)/:id", "/de/5")).toStrictEqual({
      lang: "de",
      id: "5",
    });
    expect(paramsOf("/:id/(?<id>x)", "/7/x")).toStrictEqual({ id: "x" });
  });

  it("gives a placeholder used twice the later value", () => {
    expect(paramsOf("/a/:id/b/:id", "/a/1/b/2")).toStrictEqual({ id: "2" });
  });

  it("takes placeholder names that are no valid group names", () => {
    expect(
      paramsOf("/v/:1/:_/:9lives/:constructor", "/v/a/b/c/d")
    ).toStrictEqual({ 1: "a", _: "b", "9lives": "c", constructor: "d" });
    expect(
      Object.getOwnPropertyDescriptor(
        paramsOf("/v/:__proto__", "/v/x")!,
        "__proto__"
      )?.value
    ).toBe("x");
  });

  it("leaves out a placeholder that did not take part", () => {
    const route = new KitRoute("/items(?:/:page)?", () => {});
    expect(route.match("/items").params).toStrictEqual({});
    expect(route.match("/items/2").params).toStrictEqual({ page: "2" });
  });

  it("gives the participating one of a placeholder used twice", () => {
    const route = new KitRoute("/x(?:/a/:id|/b/:id)", () => {});
    expect(route.match("/x/a/3").params).toStrictEqual({ id: "3" });
    expect(route.match("/x/b/4").params).toStrictEqual({ id: "4" });
  });

  it("takes params of a nested pattern with a capture group", () => {
    expect(
      paramsOf("/(a|b)/:id", "/b/7/edit", { matchNested: true })
    ).toStrictEqual({ id: "7" });
  });

  it("takes a wildcard placeholder and leaves a bare wildcard out", () => {
    expect(paramsOf("/f/*rest", "/f/x")).toStrictEqual({ rest: "x" });
    expect(paramsOf("/f/*/:id", "/f/a/b/9")).toStrictEqual({ id: "9" });
  });

  it("decodes values and gives {} for a malformed one", () => {
    expect(paramsOf("/(a|b)/:q", "/a/x%20y")).toStrictEqual({ q: "x y" });
    expect(paramsOf("/(a|b)/:q", "/a/%E0%A4%A")).toStrictEqual({});
  });
});

describe("KitRouter", () => {
  let router: KitRouter;

  afterEach(() => {
    router?.destroy();
    vi.restoreAllMocks();
    sessionStorage.removeItem("__kit_router_history__");
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

  it("passes named regex groups as params and the match to handler", () => {
    router = new KitRouter();
    const handler = vi.fn();
    router.on(new KitRoute(/^\/files\/(?<dir>\w+)\/(.+)$/, handler));
    handler.mockClear();

    history.replaceState({}, "", "/files/img/a.png");
    router.pushState({ url: "/files/img/a.png" });
    const data = handler.mock.calls[0][0];
    expect(data.params).toStrictEqual({ dir: "img" });
    expect(data.match[2]).toBe("a.png");
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
