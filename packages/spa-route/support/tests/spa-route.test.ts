import {
  afterEach,
  describe,
  expect,
  it,
  spyFetch,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { urlMatchesHref } from "../../src/utils";
import "../../index";

const happyDomScopeHack = (element: Element | Document) => {
  const _oldQS = element.querySelector;
  vi.spyOn(element, "querySelector").mockImplementation((str, ...args) => {
    return _oldQS.call(
      element,
      str.trim().startsWith(":scope") ? str.replace(":scope", "") : str,
      ...args,
    );
  });
};

if (!document.startViewTransition) {
  // @ts-ignore shim
  document.startViewTransition = ({ update }) => {
    update();
    return {
      ready: Promise.resolve(),
      finished: Promise.resolve(),
      skipTransition: () => {},
      cancel: () => {},
    };
  };
}

describe("spa-route / spa-a", () => {
  afterEach(() => {
    window.location.href = "/";
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("changes routes", async () => {
    document.body.innerHTML = `
      <spa-manager>
          <spa-route route-href="/a" template-ref="#rt"></spa-route>
          <spa-route route-href="/b/:foo" template-ref="/b/detail.html"></spa-route>
          <spa-route route-href="/b" match-nested>
            <template>Test 2</template>
          </spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b/123"></spa-a>
      <template id="rt"><p></p></template>
    `;
    const spaManager = document.querySelector(
      "spa-manager",
    ) as HTMLSpaManagerElement;
    const spaRouteA = document.querySelector(
      "spa-route:first-of-type",
    ) as HTMLSpaRouteElement;
    const spaRouteB = document.querySelector(
      "spa-route:nth-of-type(2)",
    ) as HTMLSpaRouteElement;
    const spaRouteB2 = document.querySelector(
      "spa-route:nth-of-type(3)",
    ) as HTMLSpaRouteElement;
    const spaAA = document.querySelector(
      "spa-a:first-of-type",
    ) as HTMLSpaAElement;
    const spaAB = document.querySelector(
      "spa-a:nth-of-type(2)",
    ) as HTMLSpaAElement;
    happyDomScopeHack(document);
    happyDomScopeHack(spaRouteB2);
    const mockListener = vi.fn();
    document.body.addEventListener("spa-route-did-render", mockListener);
    const fetchSpy = spyFetch(
      {
        status: 200,
        body: "<span></span>",
        headers: new Headers({ "content-type": "text/html" }),
      } as any,
      5,
    );
    const runCallbacksSpy = vi.spyOn(spaManager, "updateRoutes");
    const transitionSpy = vi.spyOn(document, "startViewTransition");

    // load route A
    expect(runCallbacksSpy).toHaveBeenCalledTimes(0);
    expect(transitionSpy).toHaveBeenCalledTimes(0);
    expect(spaManager.hasRendered).toBe(false);
    expect(spaManager.lastMove).toBe(null);
    expect(spaManager.activeUrl).toBe("/");
    expect(spaRouteA.children.length).toBe(0);
    spaAA.dispatchEvent(new Event("click"));
    await waitForEvent(spaRouteA, "spa-route-did-render");
    expect(mockListener).toHaveBeenCalled();
    expect(spaManager.hasRendered).toBe(true);
    expect(spaRouteA.isLoading).toBe(false);
    expect(spaRouteA.isActive).toBe(true);
    expect(spaRouteA.isError).toBe(false);
    expect(spaRouteA.templatePromise).toBeNull();
    expect(spaRouteA.children?.[0]?.nodeName).toBe("P");
    expect(spaRouteB.isActive).toBe(false);
    // First paint skips View Transitions, and so does the batch that
    // follows it (`spa-route-provision` of the same activation).
    expect(runCallbacksSpy).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenCalledTimes(0);
    // anchor is-active should be correct
    expect(spaAA.isActive).toBe(true);
    expect(spaAB.isActive).toBe(false);

    // switch to route B / B2
    await waitForEvent(spaManager, "spa-manager-push", () => {
      spaAB.dispatchEvent(new Event("click"));
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(fetchSpy).toHaveBeenCalledWith("/b/detail.html", expect.any(Object));
    // check that transition manager was called with "render"
    await waitForEvent(spaRouteB, "spa-route-did-render");
    expect(runCallbacksSpy).toHaveBeenCalledTimes(2);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(spaManager.lastMove).toBe("push");
    expect(spaManager.activeUrl).toBe("/b/123");
    expect(spaRouteB.isLoading).toBe(false);
    expect(spaRouteB.isActive).toBe(true);
    expect(spaRouteB.isError).toBe(false);
    expect(spaRouteB2.isLoading).toBe(false);
    expect(spaRouteB2.isActive).toBe(true);
    expect(spaRouteB2.isError).toBe(false);
    expect(spaRouteA.isActive).toBe(false);
    // anchor is-active should be correct
    expect(spaAA.isActive).toBe(false);
    expect(spaAB.isActive).toBe(true);

    // Simulate user back
    history.back();
    // happy-dom can't simulate back nav; these two lines stand in
    // @ts-expect-error
    history.state.id = spaManager.router?.states.slice(-2)[0].id;
    window.dispatchEvent(new Event("popstate"));

    await waitForEvent(spaRouteA, "spa-route-did-render");

    expect(runCallbacksSpy).toHaveBeenCalledTimes(3);
    expect(transitionSpy).toHaveBeenCalledTimes(2);
    expect(spaManager.lastMove).toBe("back");
    expect(spaManager.activeUrl).toBe("/a");
    expect(spaRouteA.isActive).toBe(true);
    expect(spaRouteA.isLoading).toBe(false);
    expect(spaRouteA.isError).toBe(false);
    expect(spaRouteB.isActive).toBe(false);
    // anchor is-active should be correct
    expect(spaAA.isActive).toBe(true);
    expect(spaAB.isActive).toBe(false);

    // Simulate user forward
    history.forward();
    // happy-dom can't simulate forward nav; these two lines stand in
    // @ts-expect-error
    history.state.id = spaManager.router?.states.slice(-1)[0].id;
    window.dispatchEvent(new Event("popstate"));

    await waitForEvent(spaRouteB, "spa-route-did-render");

    expect(runCallbacksSpy).toHaveBeenCalledTimes(4);
    expect(transitionSpy).toHaveBeenCalledTimes(3);
    expect(spaManager.lastMove).toBe("forward");
    expect(spaManager.activeUrl).toBe("/b/123");
    expect(spaRouteA.isActive).toBe(false);
    expect(spaRouteB.isActive).toBe(true);
    expect(spaRouteB2.isActive).toBe(true);
    // anchor is-active should be correct
    expect(spaAA.isActive).toBe(false);
    expect(spaAB.isActive).toBe(true);
  });

  it("does not activate fallback is previous route is active", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
        <spa-route route-regex=".*" is-fallback><template>Fallback</template></spa-route>
        <spa-route route-href="/"><template>C</template></spa-route>
      </spa-manager>
      <spa-a route-href="/b"></spa-a>
      <spa-a route-href="/nothing"></spa-a>
      <spa-a route-href="/nothing-else"></spa-a>
    `;
    const spaRouteA = document.querySelector(
      "spa-route:first-of-type",
    ) as HTMLSpaRouteElement;
    const spaRouteB = document.querySelector(
      "spa-route:nth-of-type(2)",
    ) as HTMLSpaRouteElement;
    const spaRouteFallback = document.querySelector(
      "spa-route:nth-of-type(3)",
    ) as HTMLSpaRouteElement;
    const spaRouteC = document.querySelector(
      "spa-route:nth-of-type(4)",
    ) as HTMLSpaRouteElement;
    expect(spaRouteA.isActive).toBe(true);
    expect(spaRouteB.isActive).toBe(false);
    expect(spaRouteFallback.isActive).toBe(false);
    expect(spaRouteC.isActive).toBe(true);

    const spaAB = document.querySelector(
      "spa-a:first-of-type",
    ) as HTMLSpaAElement;
    const spaANothing = document.querySelector(
      "spa-a:nth-of-type(2)",
    ) as HTMLSpaAElement;
    await waitForEvent(document.body, "spa-manager-rendered", () => {
      spaAB.dispatchEvent(new Event("click"));
    });
    expect(spaRouteA.isActive).toBe(false);
    expect(spaRouteB.isActive).toBe(true);
    expect(spaRouteFallback.isActive).toBe(false);
    expect(spaRouteC.isActive).toBe(false);
    expect(spaAB.isActive).toBe(true);
    expect(spaANothing.isActive).toBe(false);

    await waitForEvent(document.body, "spa-manager-rendered", () => {
      spaANothing.dispatchEvent(new Event("click"));
    });
    expect(spaRouteA.isActive).toBe(false);
    expect(spaRouteB.isActive).toBe(false);
    expect(spaRouteFallback.isActive).toBe(true);
    expect(spaRouteC.isActive).toBe(false);
    expect(spaAB.isActive).toBe(false);
    expect(spaANothing.isActive).toBe(true);

    // unmatched → unmatched: the active fallback must not count itself
    const spaANothingElse = document.querySelector(
      "spa-a:nth-of-type(3)",
    ) as HTMLSpaAElement;
    await waitForEvent(document.body, "spa-manager-rendered", () => {
      spaANothingElse.dispatchEvent(new Event("click"));
    });
    expect(spaRouteFallback.isActive).toBe(true);
    expect(spaRouteFallback.textContent).toContain("Fallback");
    expect(spaANothingElse.isActive).toBe(true);
  });
});

describe("spa-manager rapid navigation", () => {
  afterEach(() => {
    window.location.href = "/";
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("drains route callbacks queued while a view transition is in flight", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
        <spa-route route-href="/c"><template>C</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
      <spa-a route-href="/c"></spa-a>
    `;
    const spaManager = document.querySelector(
      "spa-manager",
    ) as HTMLSpaManagerElement;
    const routes = Array.from(
      document.querySelectorAll("spa-route"),
    ) as HTMLSpaRouteElement[];
    const [spaRouteA, spaRouteB, spaRouteC] = routes;
    const links = Array.from(
      document.querySelectorAll("spa-a"),
    ) as HTMLSpaAElement[];
    const [spaAA, spaAB, spaAC] = links;

    // Cold first nav: no transition (`hasRendered` still false), so the
    // route renders synchronously and we land on /a.
    await waitForEvent(spaRouteA, "spa-route-did-render", () => {
      spaAA.dispatchEvent(new Event("click"));
    });
    expect(spaRouteA.isActive).toBe(true);
    expect(spaManager.hasRendered).toBe(true);

    /* Controllable transition shim: hold each in-flight `finished` so we
       resolve it on our schedule. `skipTransition` completes it early
       (mirrors the View Transitions API). */
    const inFlight: Array<{
      complete: () => void;
      skipTransition: () => void;
    }> = [];
    vi.spyOn(document, "startViewTransition").mockImplementation(
      // @ts-ignore happy-dom test shim signature
      ({ update }: { update: () => Promise<unknown> }) => {
        update();
        let complete!: () => void;
        let settled = false;
        const finished = new Promise<void>((resolve) => {
          complete = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
        });
        const entry = {
          complete,
          skipTransition: () => complete(),
        };
        inFlight.push(entry);
        return {
          ready: Promise.resolve(),
          finished,
          skipTransition: entry.skipTransition,
        } as unknown as ViewTransition;
      },
    );

    // Click B. Transition 1 starts (shim update swaps the DOM sync), but
    // `finished` is held open.
    spaAB.dispatchEvent(new Event("click"));
    await wait(0);
    expect(inFlight.length).toBe(1);
    expect(spaRouteA.isActive).toBe(false);
    expect(spaRouteB.isActive).toBe(true);
    expect(spaManager.isTransitioning).toBe(true);

    // Click C while transition 1 is in flight. Manager should skip it so
    // queued callbacks drain immediately.
    const renderedPromise = waitForEvent(spaManager, "spa-manager-rendered");
    spaAC.dispatchEvent(new Event("click"));
    await wait(0);
    expect(spaRouteB.isActive).toBe(false);
    expect(spaRouteC.isActive).toBe(true);
    // skipTransition completed transition 1 → doCleanup started transition 2
    expect(inFlight.length).toBe(2);

    // Resolve transition 2. Now we drain to empty and emit `rendered`.
    inFlight[1].complete();
    await renderedPromise;

    expect(spaManager.isTransitioning).toBe(false);
    expect(spaManager._routeCallbacks).toEqual({
      provision: [],
      render: [],
      unrender: [],
    });
    // Final DOM: only C is rendered.
    expect(spaRouteA.querySelector("template")).not.toBeNull();
    expect(
      Array.from(spaRouteA.children).some((c) => c.tagName !== "TEMPLATE"),
    ).toBe(false);
    expect(
      Array.from(spaRouteB.children).some((c) => c.tagName !== "TEMPLATE"),
    ).toBe(false);
    expect(spaRouteC.textContent).toContain("C");
  });

  it("skips in-flight transition when back/forward is spammed", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
    `;
    const spaManager = document.querySelector(
      "spa-manager",
    ) as HTMLSpaManagerElement;
    const [spaRouteA, spaRouteB] = Array.from(
      document.querySelectorAll("spa-route"),
    ) as HTMLSpaRouteElement[];
    const [spaAA, spaAB] = Array.from(
      document.querySelectorAll("spa-a"),
    ) as HTMLSpaAElement[];

    await waitForEvent(spaRouteA, "spa-route-did-render", () => {
      spaAA.dispatchEvent(new Event("click"));
    });
    await waitForEvent(spaManager, "spa-manager-rendered", () => {
      spaAB.dispatchEvent(new Event("click"));
    });
    expect(spaRouteB.isActive).toBe(true);

    const skipSpy = vi.fn();
    const inFlight: Array<{ complete: () => void }> = [];
    vi.spyOn(document, "startViewTransition").mockImplementation(
      // @ts-ignore happy-dom test shim signature
      ({ update }: { update: () => Promise<unknown> }) => {
        update();
        let complete!: () => void;
        let settled = false;
        const finished = new Promise<void>((resolve) => {
          complete = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
        });
        inFlight.push({ complete });
        return {
          ready: Promise.resolve(),
          finished,
          skipTransition: () => {
            skipSpy();
            complete();
          },
        } as unknown as ViewTransition;
      },
    );

    // Start back navigation; hold the transition open.
    history.back();
    // @ts-expect-error happy-dom history shim
    history.state.id = spaManager.router?.states.slice(-2)[0].id;
    window.dispatchEvent(new Event("popstate"));
    await wait(0);
    expect(inFlight.length).toBe(1);
    expect(spaManager.isTransitioning).toBe(true);

    // Spam forward while transition 1 is still animating.
    history.forward();
    // @ts-expect-error happy-dom history shim
    history.state.id = spaManager.router?.states.slice(-1)[0].id;
    window.dispatchEvent(new Event("popstate"));
    await wait(0);

    expect(skipSpy).toHaveBeenCalled();
    expect(inFlight.length).toBe(2);
    expect(spaRouteB.isActive).toBe(true);

    const renderedPromise = waitForEvent(spaManager, "spa-manager-rendered");
    inFlight[1].complete();
    await renderedPromise;
    expect(spaManager.isTransitioning).toBe(false);
  });
});

describe("spa-route same-route + scroll", () => {
  afterEach(() => {
    window.location.href = "/";
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("reuses content and updates params when same-route=reuse", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/users/:id" same-route="reuse">
          <template><input id="keep" /></template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/users/1"></spa-a>
      <spa-a route-href="/users/2"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const [link1, link2] = Array.from(
      document.querySelectorAll("spa-a"),
    ) as HTMLSpaAElement[];

    await waitForEvent(route, "spa-route-did-render", () => {
      link1.dispatchEvent(new Event("click"));
    });
    const input = route.querySelector("#keep") as HTMLInputElement;
    input.value = "typed";
    expect(route.provision?.params).toEqual({ id: "1" });

    await waitForEvent(document.body, "spa-manager-rendered", () => {
      link2.dispatchEvent(new Event("click"));
    });
    expect(route.isActive).toBe(true);
    expect(route.provision?.params).toEqual({ id: "2" });
    // same node preserved
    expect(route.querySelector("#keep")).toBe(input);
    expect(input.value).toBe("typed");
  });

  it("tears down and re-renders when same-route=refresh", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/users/:id" same-route="refresh">
          <template><input id="fresh" /></template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/users/1"></spa-a>
      <spa-a route-href="/users/2"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const [link1, link2] = Array.from(
      document.querySelectorAll("spa-a"),
    ) as HTMLSpaAElement[];

    await waitForEvent(route, "spa-route-did-render", () => {
      link1.dispatchEvent(new Event("click"));
    });
    const firstInput = route.querySelector("#fresh") as HTMLInputElement;
    firstInput.value = "typed";

    await waitForEvent(route, "spa-route-did-render", () => {
      link2.dispatchEvent(new Event("click"));
    });
    expect(route.isActive).toBe(true);
    expect(route.provision?.params).toEqual({ id: "2" });
    const secondInput = route.querySelector("#fresh") as HTMLInputElement;
    expect(secondInput).not.toBe(firstInput);
    expect(secondInput.value).toBe("");
  });

  it("setScroll resets on push/replace and restores on back/forward", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const link = document.querySelector("spa-a") as HTMLSpaAElement;
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    await waitForEvent(route, "spa-route-did-render", () => {
      link.dispatchEvent(new Event("click"));
    });
    await wait(0);
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, left: 0 }),
    );
    scrollToSpy.mockClear();

    const active = {
      ...(route.provision?.active || { url: "/a", id: "1" }),
      scrollY: 240,
      scrollX: 12,
    };

    route.provision = { ...route.provision!, move: "push", active } as any;
    route.setScroll();
    await wait(0);
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, left: 0 }),
    );
    scrollToSpy.mockClear();

    route.provision = { ...route.provision!, move: "back", active } as any;
    route.setScroll();
    await wait(0);
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 240, left: 12 }),
    );
    scrollToSpy.mockClear();

    route.scrollSetDisabled = true;
    route.setScroll();
    await wait(0);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

describe("spa-route host targeting (host-ref)", () => {
  afterEach(() => {
    window.location.href = "/";
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("attaches a shadow root and renders into it when host-ref='shadow'", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/test" host-ref="shadow">
          <template><p>shadow</p></template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/test"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const link = document.querySelector("spa-a") as HTMLSpaAElement;

    // shadow root is attached as soon as host-ref is parsed
    expect(route.shadowRoot).not.toBeNull();
    expect(route.renderHost).toBe(route.shadowRoot);
    expect(route.isActive).toBe(false);

    await waitForEvent(route, "spa-route-did-render", () => {
      link.dispatchEvent(new Event("click"));
    });

    expect(route.isActive).toBe(true);
    expect(route.shadowRoot!.querySelector("p")?.textContent).toBe("shadow");
    // light DOM only holds the source <template>; no rendered <p>
    expect(route.querySelector("p")).toBeNull();
    expect(route.querySelector("template")).not.toBeNull();
  });

  it("renders into an author-provided iframe when host-ref='iframe'", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/test" host-ref="iframe">
          <template><p>in frame</p></template>
          <iframe data-render-host srcdoc="<!doctype html><html><body></body></html>"></iframe>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/test"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const link = document.querySelector("spa-a") as HTMLSpaAElement;
    const iframe = route.querySelector(
      "iframe[data-render-host]",
    ) as HTMLIFrameElement;

    expect(iframe).not.toBeNull();

    await waitForEvent(route, "spa-route-did-render", () => {
      link.dispatchEvent(new Event("click"));
    });

    expect(route.renderHost).toBe(iframe.contentDocument!.body);
    expect(
      iframe.contentDocument!.body.querySelector("p")?.textContent,
    ).toBe("in frame");
    // light DOM only holds the iframe and the source template;
    // no rendered <p> at the route's own level
    expect(Array.from(route.children).some((c) => c.tagName === "P")).toBe(
      false,
    );
  });

  it("renders into a host found by CSS selector when host-ref is a selector", async () => {
    document.body.innerHTML = `
      <div id="render-target"></div>
      <spa-manager>
        <spa-route route-href="/test" host-ref="#render-target">
          <template><p>elsewhere</p></template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/test"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const link = document.querySelector("spa-a") as HTMLSpaAElement;
    const target = document.getElementById("render-target")!;

    expect(route.renderHost).toBe(target);

    await waitForEvent(route, "spa-route-did-render", () => {
      link.dispatchEvent(new Event("click"));
    });

    expect(target.querySelector("p")?.textContent).toBe("elsewhere");
    expect(route.querySelector("p")).toBeNull();
  });

  it("keeps the author iframe when host-ref switches away from 'iframe'", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/test" host-ref="iframe">
          <template><p>x</p></template>
          <iframe data-render-host srcdoc="<!doctype html><html><body></body></html>"></iframe>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/test"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const link = document.querySelector("spa-a") as HTMLSpaAElement;

    await waitForEvent(route, "spa-route-did-render", () => {
      link.dispatchEvent(new Event("click"));
    });
    const iframe = route.querySelector(
      "iframe[data-render-host]",
    ) as HTMLIFrameElement;
    expect(iframe.contentDocument!.body.querySelector("p")).not.toBeNull();

    await waitForEvent(route, "spa-route-did-render", () => {
      route.hostRef = "shadow";
    });

    expect(route.querySelector("iframe[data-render-host]")).toBe(iframe);
    expect(iframe.contentDocument!.body.querySelector("p")).toBeNull();
    expect(route.shadowRoot!.querySelector("p")?.textContent).toBe("x");
  });

  it("re-targets rendered content when host-ref changes from light DOM to shadow", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/test">
          <template><p>moves</p></template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/test"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const link = document.querySelector("spa-a") as HTMLSpaAElement;

    await waitForEvent(route, "spa-route-did-render", () => {
      link.dispatchEvent(new Event("click"));
    });
    expect(route.querySelector("p")?.textContent).toBe("moves");
    expect(route.shadowRoot).toBeNull();

    await waitForEvent(route, "spa-route-did-render", () => {
      route.hostRef = "shadow";
    });

    expect(route.shadowRoot).not.toBeNull();
    expect(route.shadowRoot!.querySelector("p")?.textContent).toBe("moves");
    expect(route.querySelector("p")).toBeNull();
  });

  it("clears the external selector host when route deactivates", async () => {
    document.body.innerHTML = `
      <div id="render-target"></div>
      <spa-manager>
        <spa-route route-href="/test" host-ref="#render-target">
          <template><p>routed</p></template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/test"></spa-a>
    `;
    const route = document.querySelector("spa-route") as HTMLSpaRouteElement;
    const link = document.querySelector("spa-a") as HTMLSpaAElement;
    const target = document.getElementById("render-target")!;

    await waitForEvent(route, "spa-route-did-render", () => {
      link.dispatchEvent(new Event("click"));
    });
    expect(target.querySelector("p")).not.toBeNull();

    route.isActive = false;
    await wait(0);

    expect(target.querySelector("p")).toBeNull();
  });
});

describe("utils", () => {
  it("urlMatchesHref", () => {
    expect(urlMatchesHref("/a", "/a")).toBe(true);
    expect(urlMatchesHref("/a", "/b")).toBe(false);
    expect(urlMatchesHref("/a", "/a/")).toBe(false);
    expect(urlMatchesHref("/a/", "/a")).toBe(false);
    expect(urlMatchesHref("/a", "/a/b")).toBe(false);
    expect(urlMatchesHref("/a/b", "/a")).toBe(false);
    expect(urlMatchesHref("/a/b", "/a/b")).toBe(true);
    // search
    expect(urlMatchesHref("/a?foo=1", "/a?foo=1")).toBe(true);
    expect(urlMatchesHref("/a?foo=1", "/a/?foo=2")).toBe(false);
    expect(urlMatchesHref("/a?foo=1", "/a/?foo=1&bar=2")).toBe(false);
    expect(urlMatchesHref("/a?foo=1&bar=2", "/a?bar=2&foo=1")).toBe(true);
    // hash
    expect(urlMatchesHref("/a#foo", "/a#foo")).toBe(true);
    expect(urlMatchesHref("/a#foo", "/a/#bar")).toBe(false);
    expect(urlMatchesHref("/a#foo", "/a/#foo/bar")).toBe(false);
    expect(urlMatchesHref("/a#foo/bar", "/a/#foo")).toBe(false);
    expect(urlMatchesHref("/a/b", "/a/b#foo")).toBe(false);
    // same tests with ignoreHash: true (pathname still must match)
    expect(urlMatchesHref("/a", "/a#foo", { ignoreHash: true })).toBe(true);
    expect(urlMatchesHref("/a", "/a/#bar", { ignoreHash: true })).toBe(false);
    expect(urlMatchesHref("/a/", "/a/#bar", { ignoreHash: true })).toBe(true);
    expect(urlMatchesHref("/a", "/a#foo/bar", { ignoreHash: true })).toBe(true);
    expect(urlMatchesHref("/a/b", "/a/b#foo", { ignoreHash: true })).toBe(true);
  });
});
