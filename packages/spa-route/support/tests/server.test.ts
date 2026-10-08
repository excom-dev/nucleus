/** The server entry's hooks: the router reset before a page, the soft-404 check after it. */
import "../../index";
import { afterRender, beforeRender } from "../../server";
import { resetRouter } from "../../testing";
import { kitRouter } from "@excom/kit-router";
import { afterEach, describe, expect, it } from "@excom/nucleus-test";

const router = kitRouter as unknown as { states: object[]; currentStateId: string | null };

/** A rendered page: `routes` as `<spa-route>` attribute lists. */
const page = (...routes: string[]) =>
  new DOMParser().parseFromString(
    `<body>${routes.map((attributes) => `<spa-route ${attributes}></spa-route>`).join("")}</body>`,
    "text/html",
  );
const MATCHED = ['route-href="/shop" is-active', 'route-regex=".*" is-fallback'];
const UNMATCHED = ['route-href="/shop"', 'route-regex=".*" is-fallback is-active'];

describe("spa-route server entry", () => {
  afterEach(() => resetRouter());

  it("beforeRender puts the router back to a cold load of the page's URL", () => {
    resetRouter("/");
    kitRouter.pushState({ url: "/shop" });
    kitRouter.pushState({ url: "/shop/tables" });
    expect(router.states).toHaveLength(3);
    beforeRender({ url: "/menu?page=2" });
    expect(location.pathname + location.search).toBe("/menu?page=2");
    expect(router.states).toEqual([{ id: "init", url: "/menu?page=2", isInit: true }]);
    expect(router.currentStateId).toBe("init");
  });

  it("afterRender passes a page a route matches, and the not-found page the fallback route renders", () => {
    expect(() => afterRender({ url: "/shop", notFound: false, document: page(...MATCHED) })).not.toThrow();
    expect(() => afterRender({ url: "/404", notFound: true, document: page(...UNMATCHED) })).not.toThrow();
  });

  it("afterRender fails a soft 404, and a not-found page a route matches", () => {
    expect(() => afterRender({ url: "/shop/gone", notFound: false, document: page(...UNMATCHED) })).toThrow(
      "/shop/gone matches no route",
    );
    expect(() => afterRender({ url: "/404", notFound: true, document: page(...MATCHED) })).toThrow(
      "/404 is not the fallback route: the not-found page needs a <spa-route is-fallback> that matches it",
    );
  });

  it("afterRender asks the outermost routes only: a nested layout's fallback is part of an ordinary page", () => {
    /** A page whose `/account` layout holds a manager of its own, with the given routes active. */
    const nested = (outer: string, inner: string) =>
      new DOMParser().parseFromString(
        `<body><spa-manager>
          <spa-route route-href="/account" match-nested ${outer === "layout" ? "is-active" : ""}>
            <spa-manager>
              <spa-route route-href="/account/orders" ${inner === "orders" ? "is-active" : ""}></spa-route>
              <spa-route route-regex=".*" is-fallback ${inner === "fallback" ? "is-active" : ""}></spa-route>
            </spa-manager>
          </spa-route>
          <spa-route route-regex=".*" is-fallback ${outer === "fallback" ? "is-active" : ""}></spa-route>
        </spa-manager></body>`,
        "text/html",
      );
    // the layout matched, its inner fallback shows: an ordinary page
    expect(() => afterRender({ url: "/account/settings", notFound: false, document: nested("layout", "fallback") })).not.toThrow();
    // as the not-found page, an inner fallback alone is not the site's
    expect(() => afterRender({ url: "/account/settings", notFound: true, document: nested("layout", "fallback") })).toThrow(
      "/account/settings is not the fallback route",
    );
    expect(() => afterRender({ url: "/404", notFound: true, document: nested("fallback", "") })).not.toThrow();
    expect(() => afterRender({ url: "/gone", notFound: false, document: nested("fallback", "") })).toThrow("/gone matches no route");
  });

  it("afterRender passes a page with no route, unless it is the not-found page", () => {
    expect(() => afterRender({ url: "/", notFound: false, document: page() })).not.toThrow();
    // a caller that says nothing (a hand-written call) means an ordinary page
    expect(() => afterRender({ url: "/shop", document: page(...MATCHED) } as never)).not.toThrow();
    expect(() => afterRender({ url: "/404", notFound: true, document: page() })).toThrow("/404 is not the fallback route");
    // routes, none of them a fallback
    expect(() => afterRender({ url: "/404", notFound: true, document: page('route-href="/" is-active') })).toThrow(
      "/404 is not the fallback route",
    );
  });
});
