import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { urlMatchesHref } from "../../src/utils";
import "../../index";
import { KitLogger } from "@excom/kit-logger";
import { kitRouter } from "@excom/kit-router";

if (!document.startViewTransition) {
  /*
   * Shim: like a browser, `finished` settles only after the update
   * callback (exercises spa-manager's render-timeout / allSettled).
   * @ts-ignore shim
   */
  document.startViewTransition = ({ update }) => {
    const done = Promise.resolve(update()).then(() => {});
    return {
      ready: done,
      updateCallbackDone: done,
      finished: done,
      skipTransition: () => {},
      cancel: () => {},
    };
  };
}

type RouterState = {
  id: string;
  url: string;
  title?: string;
  ttypes?: string[];
  isInit?: boolean;
};
type RouterInternals = {
  states: RouterState[];
  currentStateId: string | null;
  currentTempData: { move: null | string; event?: unknown };
  routes: unknown[];
};
const router = kitRouter as unknown as RouterInternals & typeof kitRouter;

/** Put the singleton router back to a cold-load state. */
const resetRouter = () => {
  history.replaceState(null, "", "/");
  router.states = [{ id: "init", url: "/", isInit: true }];
  router.currentStateId = null;
  router.currentTempData = { move: null };
  router.MAX_STATES = router.DEFAULT_MAX_STATES;
};

/** Emulate the browser landing on a known history entry (back / forward). */
const popstate = (state: RouterState, hasUAVisualTransition = false) => {
  history.replaceState({ id: state.id }, "", state.url);
  const e = new PopStateEvent("popstate");
  Object.defineProperty(e, "hasUAVisualTransition", {
    value: hasUAVisualTransition,
  });
  window.dispatchEvent(e);
};

const click = (el: Element) => el.dispatchEvent(new Event("click"));

/**
 * Navigate and wait for the manager to settle. A cold first paint
 * renders synchronously, but `spa-route-provision` still batches once
 * `has-rendered` flips, so `spa-manager-rendered` follows every nav.
 */
const navigate = (manager: Element, trigger: () => void) =>
  waitForEvent(manager, "spa-manager-rendered", trigger);

const captureEvent = <T = unknown>(target: EventTarget, type: string) => {
  const events: CustomEvent<T>[] = [];
  target.addEventListener(type, (e) => events.push(e as CustomEvent<T>));
  return events;
};

const hasRenderedContent = (route: Element) =>
  Array.from(route.children).some((c) => c.tagName !== "TEMPLATE");

const q = <T extends Element>(selector: string) =>
  document.querySelector(selector) as T;
const qa = <T extends Element>(selector: string) =>
  Array.from(document.querySelectorAll(selector)) as T[];

const touch = (
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: Array<{ identifier: number; clientX: number; clientY: number }>
) => {
  const e = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(e, "touches", { value: touches });
  document.dispatchEvent(e);
  return e;
};

describe("spa-a actions", () => {
  beforeEach(resetRouter);
  afterEach(() => {
    document.body.innerHTML = "";
    router.routes = [];
    vi.restoreAllMocks();
    resetRouter();
  });

  it("walks history with route-action back / forward when possible", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
      <spa-a route-action="back"></spa-a>
      <spa-a route-action="forward"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [routeA, routeB] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkB, back, forward] = qa<HTMLSpaAElement>("spa-a");
    const goSpy = vi.spyOn(history, "go").mockImplementation(() => {});
    const errorSpy = vi
      .spyOn(KitLogger, "error")
      .mockImplementation(() => {});
    const backEvents = captureEvent(manager, "spa-manager-back");
    const forwardEvents = captureEvent(manager, "spa-manager-forward");

    await navigate(manager, () => click(linkA));
    await navigate(manager, () => click(linkB));
    expect(linkA.wasActive).toBe(true);
    expect(linkB.wasActive).toBe(false);

    // cannot go forward from the newest entry: logs, does nothing
    click(forward);
    expect(goSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenLastCalledWith("spa-a", "Cannot go forward");

    click(back);
    expect(goSpy).toHaveBeenLastCalledWith(-1);

    // the browser lands on /a
    await navigate(manager, () => popstate(router.states[1]));
    expect(backEvents).toHaveLength(1);
    expect(manager.lastMove).toBe("back");
    expect(manager.activeUrl).toBe("/a");
    expect(routeA.isActive).toBe(true);
    expect(routeB.isActive).toBe(false);
    expect(routeB.wasActive).toBe(true);
    expect(linkB.wasActive).toBe(true);
    expect(linkA.isActive).toBe(true);

    click(forward);
    expect(goSpy).toHaveBeenLastCalledWith(1);
    await navigate(manager, () => popstate(router.states[2]));
    expect(forwardEvents).toHaveLength(1);
    expect(manager.lastMove).toBe("forward");
    expect(routeB.isActive).toBe(true);
    expect(routeA.wasActive).toBe(true);

    // back to the initial entry (no route matches), then back is refused
    await navigate(manager, () => popstate(router.states[0]));
    expect(routeB.isActive).toBe(false);
    expect(hasRenderedContent(routeB)).toBe(false);
    goSpy.mockClear();
    click(back);
    expect(goSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenLastCalledWith("spa-a", "Cannot go back");
  });

  it("falls back to push when back / forward is impossible but route-href is set", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-action="back" route-href="/a"></spa-a>
      <spa-a route-action="forward" route-href="/b"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [, routeB] = qa<HTMLSpaRouteElement>("spa-route");
    const [backLink, forwardLink] = qa<HTMLSpaAElement>("spa-a");
    const goSpy = vi.spyOn(history, "go").mockImplementation(() => {});

    await navigate(manager, () => click(backLink));
    expect(goSpy).not.toHaveBeenCalled();
    expect(manager.activeUrl).toBe("/a");
    expect(backLink.isActive).toBe(true);

    await navigate(manager, () => click(forwardLink));
    expect(goSpy).not.toHaveBeenCalled();
    expect(manager.lastMove).toBe("push");
    expect(routeB.isActive).toBe(true);
  });

  it("logs when there is nothing to navigate to", () => {
    document.body.innerHTML = `<spa-a></spa-a>`;
    const errorSpy = vi
      .spyOn(KitLogger, "error")
      .mockImplementation(() => {});
    const before = router.states.length;
    click(q("spa-a"));
    expect(errorSpy).toHaveBeenCalledWith("spa-a", "No route-href provided");
    expect(router.states.length).toBe(before);
  });

  it("replaces the current entry with route-action=replace", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/r"><template>R</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/r" route-action="replace"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [routeA, routeR] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkR] = qa<HTMLSpaAElement>("spa-a");
    const replaceEvents = captureEvent(manager, "spa-manager-replace");

    await navigate(manager, () => click(linkA));
    expect(router.states.map((s) => s.url)).toEqual(["/", "/a"]);

    await navigate(manager, () => click(linkR));
    expect(replaceEvents).toHaveLength(1);
    expect(router.states.map((s) => s.url)).toEqual(["/", "/r"]);
    expect(manager.lastMove).toBe("replace");
    expect(manager.activeUrl).toBe("/r");
    expect(routeA.isActive).toBe(false);
    expect(routeR.isActive).toBe(true);
    // the replaced entry is gone: the previous entry is now `/`
    expect(routeA.wasActive).toBe(false);
    expect(linkA.wasActive).toBe(false);
    expect(routeR.provision?.previous).toEqual(
      expect.objectContaining({ url: "/" })
    );
    expect(kitRouter.canGoBack()).toBe(true);
  });

  it("replace as the very first move leaves no previous entry", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/"><template>Home</template></spa-route>
        <spa-route route-href="/x"><template>X</template></spa-route>
      </spa-manager>
      <spa-a route-href="/x" route-action="replace"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [home, x] = qa<HTMLSpaRouteElement>("spa-route");
    expect(home.isActive).toBe(true);
    await waitForEvent(manager, "spa-manager-rendered");
    expect(home.provision?.move).toBeNull();
    expect(home.provision?.previous).toBeNull();

    await navigate(manager, () => click(q("spa-a")));
    expect(router.states.map((s) => s.url)).toEqual(["/x"]);
    expect(home.isActive).toBe(false);
    // no previous entry survives a first-move replace
    expect(home.wasActive).toBe(false);
    expect(x.isActive).toBe(true);
    expect(x.provision?.previous).toBeNull();
  });

  it("passes document-title and transition-types to the router / view transition", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/t"><template>T</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/t" document-title="Title T" transition-types="fade slide"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [linkA, linkT] = qa<HTMLSpaAElement>("spa-a");
    const transitionSpy = vi.spyOn(document, "startViewTransition");
    const transitionEvents = captureEvent<{ transition: ViewTransition }>(
      manager,
      "spa-manager-transition"
    );

    await navigate(manager, () => click(linkA));
    transitionSpy.mockClear();
    transitionEvents.length = 0;

    await navigate(manager, () => click(linkT));
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(transitionEvents).toHaveLength(1);
    expect(transitionEvents[0].detail.transition).toBe(
      transitionSpy.mock.results[0].value
    );
    expect(transitionSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ types: ["route-push", "fade", "slide"] })
    );
    expect(manager.provision?.active).toEqual(
      expect.objectContaining({
        url: "/t",
        title: "Title T",
        ttypes: ["fade", "slide"],
      })
    );

    // going back uses the outgoing entry's types
    await navigate(manager, () => popstate(router.states[1]));
    expect(transitionSpy.mock.calls[1][0]).toEqual(
      expect.objectContaining({ types: ["route-back", "fade", "slide"] })
    );
  });

  it("honours match-hash for is-active and resets is-active when route-href is removed", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/h"><template>H</template></spa-route>
      </spa-manager>
      <spa-a route-href="/h#x" match-hash></spa-a>
      <spa-a route-href="/h#x"></spa-a>
      <spa-a route-href="/h#y"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [strict, loose, other] = qa<HTMLSpaAElement>("spa-a");

    await navigate(manager, () => click(other));
    expect(location.hash).toBe("#y");
    expect(strict.isActive).toBe(false);
    expect(loose.isActive).toBe(true);
    expect(other.isActive).toBe(true);

    click(strict);
    await wait(5);
    expect(location.hash).toBe("#x");
    expect(strict.isActive).toBe(true);
    expect(loose.isActive).toBe(true);
    expect(loose.wasActive).toBe(true);
    expect(other.isActive).toBe(true);

    loose.routeHref = null;
    await wait(0);
    expect(loose.isActive).toBe(false);
    expect(loose.routeInstance).toBeNull();
  });

  it("navigating to the current URL keeps the rendered screen", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template><p>A</p></template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const route = q<HTMLSpaRouteElement>("spa-route");
    const link = q<HTMLSpaAElement>("spa-a");
    const renderSpy = vi.fn();
    route.addEventListener("spa-route-did-render", renderSpy);

    await navigate(manager, () => click(link));
    const p = route.querySelector("p");
    await waitForEvent(manager, "spa-manager-push", () => click(link));
    await wait(5);
    expect(router.states.map((s) => s.url)).toEqual(["/", "/a", "/a"]);
    expect(route.isActive).toBe(true);
    expect(link.isActive).toBe(true);
    expect(route.querySelector("p")).toBe(p);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe("spa-route", () => {
  beforeEach(resetRouter);
  afterEach(() => {
    document.body.innerHTML = "";
    router.routes = [];
    vi.restoreAllMocks();
    resetRouter();
  });

  it("exposes the route payload as provision and announces it", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/items/:id" scroll-reset-y="push" scroll-reset-behavior="smooth">
          <template>Item</template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/items/123"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const route = q<HTMLSpaRouteElement>("spa-route");
    const provisionEvents = captureEvent(manager, "neutron-provision");
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    expect(route.provision ?? null).toBeNull();
    await navigate(manager, () => click(q("spa-a")));
    await wait(5);

    expect(route.provision).toEqual(
      expect.objectContaining({
        routeHref: "/items/:id",
        matchNested: false,
        scrollResetY: ["push"],
        scrollResetX: ["push", "replace"],
        scrollResetBehavior: "smooth",
        noTransition: false,
        params: { id: "123" },
        move: "push",
        next: null,
        previous: expect.objectContaining({ url: "/" }),
        active: expect.objectContaining({ url: "/items/123" }),
      })
    );
    expect(route.provision!.match![0]).toBe("/items/123");
    // both the route and the manager announce their provision (bubbling)
    expect(provisionEvents.filter((e) => e.target === route)).toHaveLength(1);
    expect(provisionEvents.filter((e) => e.target === manager)).toHaveLength(1);
    expect(manager.provision).toEqual(
      expect.objectContaining({
        move: "push",
        params: {},
        active: expect.objectContaining({ url: "/items/123" }),
      })
    );
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "smooth",
    });
  });

  it("ignores routeChanged when no route is registered", () => {
    document.body.innerHTML = `<spa-route><template>x</template></spa-route>`;
    const route = q<HTMLSpaRouteElement>("spa-route");
    expect(route.routeInstance ?? null).toBeNull();
    expect(
      route.routeChanged({ match: ["/"], params: {} } as never)
    ).toBeUndefined();
    expect(route.isActive).toBe(false);
  });

  it("works without a manager and lets spa-route-provision be deferred", async () => {
    document.body.innerHTML = `
      <spa-route route-href="/solo/:id"><template><p>solo</p></template></spa-route>
    `;
    const route = q<HTMLSpaRouteElement>("spa-route");
    let thunk: (() => void) | null = null;
    const defer = (e: Event) => {
      e.preventDefault();
      thunk = (e as CustomEvent).detail;
    };
    route.addEventListener("spa-route-provision", defer);

    await waitForEvent(route, "spa-route-did-render", () =>
      kitRouter.pushState({ url: "/solo/1" })
    );
    expect(route.isActive).toBe(true);
    expect(route.querySelector("p")?.textContent).toBe("solo");
    expect(route.provision ?? null).toBeNull();
    expect(route.readyPromiseObject).not.toBeNull();

    thunk!();
    await wait(0);
    expect(route.provision?.params).toEqual({ id: "1" });
    expect(route.readyPromiseObject).toBeNull();

    route.removeEventListener("spa-route-provision", defer);
    kitRouter.pushState({ url: "/solo/2" });
    await wait(0);
    expect(route.provision?.params).toEqual({ id: "2" });

    kitRouter.pushState({ url: "/elsewhere" });
    await wait(0);
    expect(route.isActive).toBe(false);
    expect(route.provision ?? null).toBeNull();
    expect(hasRenderedContent(route)).toBe(false);
  });

  it("keeps a nested layout mounted while child routes swap", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/users" match-nested>
          <template>
            <section id="layout">
              <spa-manager>
                <spa-route route-href="/users/:id"><template><p id="detail">detail</p></template></spa-route>
                <spa-route route-href="/users/:id/edit"><template><p id="edit">edit</p></template></spa-route>
              </spa-manager>
            </section>
          </template>
        </spa-route>
      </spa-manager>
      <spa-a route-href="/users/42"></spa-a>
      <spa-a route-href="/users/42/edit"></spa-a>
    `;
    const outerManager = q<HTMLSpaManagerElement>("spa-manager");
    const layout = q<HTMLSpaRouteElement>("spa-route");
    const [toDetail, toEdit] = qa<HTMLSpaAElement>("spa-a");

    await navigate(outerManager, () => click(toDetail));
    await wait(5);
    const innerManager = q<HTMLSpaManagerElement>("#layout spa-manager");
    const [detail, edit] = Array.from(
      innerManager.querySelectorAll("spa-route")
    ) as HTMLSpaRouteElement[];
    expect(layout.isActive).toBe(true);
    expect(layout.provision?.params).toEqual({});
    expect(detail.isActive).toBe(true);
    expect(detail.provision?.params).toEqual({ id: "42" });
    expect(edit.isActive).toBe(false);
    expect(q("#detail")).not.toBeNull();
    expect(q("#edit")).toBeNull();

    const layoutRenders = captureEvent(layout, "spa-route-did-render");
    await navigate(innerManager, () => click(toEdit));
    expect(layout.isActive).toBe(true);
    // did-render bubbles up from the inner routes; the layout itself stays put
    expect(layoutRenders.filter((e) => e.target === layout)).toHaveLength(0);
    expect(layoutRenders.filter((e) => e.target === edit)).toHaveLength(1);
    expect(q("#layout")).not.toBeNull();
    expect(edit.isActive).toBe(true);
    expect(edit.provision?.params).toEqual({ id: "42" });
    expect(detail.isActive).toBe(false);
    expect(q("#edit")).not.toBeNull();
    expect(q("#detail")).toBeNull();
  });

  describe("ready-on", () => {
    it("resolves ready when the ready-on event fires", async () => {
      document.body.innerHTML = `
        <spa-manager>
          <spa-route route-href="/rd" ready-on="content-ready"><template>RD</template></spa-route>
        </spa-manager>
        <spa-a route-href="/rd"></spa-a>
      `;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      const route = q<HTMLSpaRouteElement>("spa-route");
      const scrollToSpy = vi
        .spyOn(window, "scrollTo")
        .mockImplementation(() => {});

      await waitForEvent(route, "spa-route-did-render", () =>
        click(q("spa-a"))
      );
      await wait(5);
      expect(route.delayingReady).toBe(true);
      expect(route.readyPromiseObject).not.toBeNull();
      expect(scrollToSpy).not.toHaveBeenCalled();
      // the batched provision waits on ready (first paint: no View Transition)
      expect(manager.executingTransition).toBe(true);

      await navigate(manager, () =>
        route.dispatchEvent(new Event("content-ready"))
      );
      await wait(5);
      expect(route.delayingReady).toBe(false);
      expect(route.readyPromiseObject).toBeNull();
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
      expect(manager.isTransitioning).toBe(false);
    });

    it("rejects ready when torn down mid-flight", async () => {
      document.body.innerHTML = `
        <spa-manager>
          <spa-route route-href="/rd" ready-on="content-ready"><template>RD</template></spa-route>
          <spa-route route-href="/a"><template>A</template></spa-route>
        </spa-manager>
        <spa-a route-href="/rd"></spa-a>
        <spa-a route-href="/a"></spa-a>
      `;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      const [routeRd, routeA] = qa<HTMLSpaRouteElement>("spa-route");
      const [linkRd, linkA] = qa<HTMLSpaAElement>("spa-a");
      const scrollToSpy = vi
        .spyOn(window, "scrollTo")
        .mockImplementation(() => {});
      await waitForEvent(routeRd, "spa-route-did-render", () => click(linkRd));
      await wait(5);
      const settled = vi.fn();
      routeRd.readyPromiseObject!.promise.then(
        () => settled("resolved"),
        () => settled("rejected")
      );

      await navigate(manager, () => click(linkA));
      await wait(5);
      expect(settled).toHaveBeenCalledWith("rejected");
      expect(routeRd.isActive).toBe(false);
      expect(routeRd.delayingReady).toBe(false);
      expect(routeRd.readyPromiseObject).toBeNull();
      expect(routeA.isActive).toBe(true);
      // scroll only runs for a successful ready (route A)
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("spa-manager", () => {
  beforeEach(resetRouter);
  afterEach(() => {
    document.body.innerHTML = "";
    router.routes = [];
    // one test below fakes timers; make sure a failure there cannot leak them
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { ontouchstart?: unknown }).ontouchstart;
    delete (navigator as unknown as { maxTouchPoints?: unknown })
      .maxTouchPoints;
    resetRouter();
  });

  it("transitions the first render with transition-first-render", async () => {
    const transitionSpy = vi.spyOn(document, "startViewTransition");
    document.body.innerHTML = `
      <spa-manager transition-first-render>
        <spa-route route-href="/"><template>Home</template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    await waitForEvent(manager, "spa-manager-rendered");
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    // cold load has no move, so no `route-*` type
    expect(transitionSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ types: [] })
    );
    expect(manager.hasRendered).toBe(true);
    expect(manager.lastMove ?? null).toBeNull();
    expect(q("spa-route").textContent).toContain("Home");
  });

  it("skips view transitions with no-transition on the manager or the route", async () => {
    document.body.innerHTML = `
      <spa-manager no-transition>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [routeA, routeB] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkB] = qa<HTMLSpaAElement>("spa-a");
    const transitionSpy = vi.spyOn(document, "startViewTransition");

    await waitForEvent(routeA, "spa-route-did-render", () => click(linkA));
    await waitForEvent(routeB, "spa-route-did-render", () => click(linkB));
    await wait(5);
    expect(transitionSpy).not.toHaveBeenCalled();
    expect(manager.hasRendered).toBe(true);

    manager.noTransition = false;
    routeA.noTransition = true;
    await wait(0);
    await navigate(manager, () => click(linkA));
    expect(routeA.isActive).toBe(true);
    expect(routeA.textContent).toContain("A");
    // route B (no opt-out) is still batched into a transition
    expect(transitionSpy).toHaveBeenCalledTimes(1);
  });

  it("settles a batched render whose route was deactivated before it ran", async () => {
    document.body.innerHTML = `
      <spa-manager transition-delay="20" render-timeout="5000">
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [routeA, routeB] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkB] = qa<HTMLSpaAElement>("spa-a");

    // Warm up: `has-rendered` flips, so the next nav is a real batch.
    await navigate(manager, () => click(linkA));
    expect(manager.hasRendered).toBe(true);

    /* Queue A -> B, then flip back to A synchronously. Route B's render
       callback is in the batch, but B is inactive by the time it runs.
       `waitForEvent` rejects after 1s, well before `render-timeout`. */
    const settled = vi.fn();
    await navigate(manager, () => {
      click(linkB);
      expect(routeB.readyPromiseObject).not.toBeNull();
      routeB.readyPromiseObject!.promise.then(
        () => settled("resolved"),
        () => settled("rejected")
      );
      click(linkA);
    });
    await wait(0);

    // The batch awaited this promise; an abort must reject, never hang
    expect(settled).toHaveBeenCalledWith("rejected");
    expect(routeA.isActive).toBe(true);
    expect(routeB.isActive).toBe(false);
    // The stale render settled rather than leaking a pending promise
    expect(routeB.readyPromiseObject).toBeNull();
    expect(hasRenderedContent(routeB)).toBe(false);
    expect(hasRenderedContent(routeA)).toBe(true);
    expect(manager.isTransitioning).toBe(false);
  });

  it("does not transition when the browser already animated the navigation", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [routeA] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkB] = qa<HTMLSpaAElement>("spa-a");
    await navigate(manager, () => click(linkA));
    await navigate(manager, () => click(linkB));

    const transitionSpy = vi.spyOn(document, "startViewTransition");
    await navigate(manager, () => popstate(router.states[1], true));
    expect(manager.provision?.event).toEqual({ hasUAVisualTransition: true });
    expect(transitionSpy).not.toHaveBeenCalled();
    expect(manager.isTransitioning).toBe(false);
    expect(routeA.isActive).toBe(true);
    expect(routeA.textContent).toContain("A");
  });

  it("lets spa-manager-will-transition be canceled and drained later", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [routeA, routeB] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkB] = qa<HTMLSpaAElement>("spa-a");
    await navigate(manager, () => click(linkA));

    manager.addEventListener(
      "spa-manager-will-transition",
      (e) => e.preventDefault(),
      { once: true }
    );
    const transitionSpy = vi.spyOn(document, "startViewTransition");
    click(linkB);
    await wait(5);
    expect(routeB.isActive).toBe(true);
    expect(manager.hasCallbacks()).toBe(true);
    expect(hasRenderedContent(routeB)).toBe(false);
    expect(hasRenderedContent(routeA)).toBe(true);
    expect(transitionSpy).not.toHaveBeenCalled();

    await navigate(manager, () => manager.updateRoutes(false));
    expect(transitionSpy).not.toHaveBeenCalled();
    expect(hasRenderedContent(routeB)).toBe(true);
    expect(hasRenderedContent(routeA)).toBe(false);
    expect(manager.hasCallbacks()).toBe(false);
  });

  it("tolerates a partially initialised callback queue", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [, routeB] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkB] = qa<HTMLSpaAElement>("spa-a");
    await navigate(manager, () => click(linkA));

    manager._routeCallbacks = {} as never;
    await navigate(manager, () => click(linkB));
    expect(routeB.textContent).toContain("B");

    manager._routeCallbacks = {} as never;
    await navigate(manager, () => manager._updateRoutes(false));
    expect(manager._routeCallbacks).toEqual({
      provision: [],
      render: [],
      unrender: [],
    });
  });

  it("delays the transition with transition-delay and reschedules on repeat", async () => {
    document.body.innerHTML = `
      <spa-manager transition-delay="10">
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/b"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [, routeB] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkB] = qa<HTMLSpaAElement>("spa-a");
    await navigate(manager, () => click(linkA));

    // Fake timers from here: the assertions are that the 10ms delay is still
    // pending, which a real `wait(0)` can outlive on a loaded machine.
    vi.useFakeTimers();
    const transitionSpy = vi.spyOn(document, "startViewTransition");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const rendered = waitForEvent(manager, "spa-manager-rendered");
    click(linkB);
    await vi.advanceTimersByTimeAsync(0);
    const firstId = manager.transitionDelayId;
    expect(firstId).not.toBeNull();
    expect(transitionSpy).not.toHaveBeenCalled();
    // a second request while the delay is pending restarts the timer
    manager.updateRoutes(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(clearSpy).toHaveBeenCalledWith(firstId);
    expect(manager.transitionDelayId).not.toBe(firstId);
    await vi.advanceTimersByTimeAsync(20);
    await rendered;
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(manager.transitionDelayId).toBeNull();
    expect(routeB.textContent).toContain("B");
  });

  it("forces the transition to settle after render-timeout", async () => {
    document.body.innerHTML = `
      <spa-manager render-timeout="20">
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/slow" ready-on="content-ready"><template>Slow</template></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/slow"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [, routeSlow] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkSlow] = qa<HTMLSpaAElement>("spa-a");
    await navigate(manager, () => click(linkA));

    const started = Date.now();
    await navigate(manager, () => click(linkSlow));
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(routeSlow.delayingReady).toBe(true);
    expect(routeSlow.textContent).toContain("Slow");
    expect(manager.isTransitioning).toBe(false);
    routeSlow.dispatchEvent(new Event("content-ready"));
    await wait(0);
    expect(routeSlow.delayingReady).toBe(false);
  });

  it("re-emits child errors as spa-manager-error without a transition", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/broken" template-ref="#does-not-exist"></spa-route>
      </spa-manager>
      <spa-a route-href="/a"></spa-a>
      <spa-a route-href="/broken"></spa-a>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [, routeBroken] = qa<HTMLSpaRouteElement>("spa-route");
    const [linkA, linkBroken] = qa<HTMLSpaAElement>("spa-a");
    vi.spyOn(KitLogger, "error").mockImplementation(() => {});
    const bodyErrorSpy = vi.fn();
    document.body.addEventListener("spa-route-error", bodyErrorSpy);
    const managerErrors = captureEvent(manager, "spa-manager-error");
    await navigate(manager, () => click(linkA));

    const transitionSpy = vi.spyOn(document, "startViewTransition");
    await navigate(manager, () => click(linkBroken));
    await wait(5);
    expect(managerErrors).toHaveLength(1);
    expect(managerErrors[0].detail).toBeDefined();
    expect(routeBroken.isError).toBe(true);
    expect(routeBroken.isActive).toBe(true);
    // the child error is consumed by the manager
    expect(bodyErrorSpy).not.toHaveBeenCalled();
    expect(manager.isTransitioning).toBe(false);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
  });

  it("caps router history with max-states", () => {
    document.body.innerHTML = `<spa-manager max-states="2"></spa-manager>`;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    expect(kitRouter.MAX_STATES).toBe(2);
    kitRouter.pushState({ url: "/1" });
    kitRouter.pushState({ url: "/2" });
    kitRouter.pushState({ url: "/3" });
    expect(router.states.map((s) => s.url)).toEqual(["/2", "/3"]);
    manager.maxStates = null;
    expect(kitRouter.MAX_STATES).toBe(kitRouter.DEFAULT_MAX_STATES);
  });

  it("unregisters from the router on disconnect", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const route = q<HTMLSpaRouteElement>("spa-route");
    const managerRoute = manager.routeInstance!;
    const childRoute = route.routeInstance!;
    expect(managerRoute.key).toBeInstanceOf(RegExp);
    const offSpy = vi.spyOn(kitRouter, "off");

    manager.remove();
    await wait(0);
    expect(offSpy).toHaveBeenCalledWith(managerRoute);
    expect(offSpy).toHaveBeenCalledWith(childRoute);
    expect(manager.routeInstance).toBeNull();
    expect(route.routeInstance).toBeNull();
  });

  describe("touch edge-swipe", () => {
    const listenerCount = (type: string) =>
      globalThis.getEventListeners(document)[type]?.length ?? 0;

    it("ignores overscroll-behavior-x on non-touch devices", () => {
      const before = listenerCount("touchstart");
      document.body.innerHTML = `<spa-manager overscroll-behavior-x="navigate"></spa-manager>`;
      expect(listenerCount("touchstart")).toBe(before);
      touch("touchstart", [{ identifier: 1, clientX: 5, clientY: 50 }]);
      expect(q<HTMLSpaManagerElement>("spa-manager").swipeTracker ?? null).toBe(
        null
      );
    });

    it("navigates back / forward from the edges", () => {
      (window as unknown as { ontouchstart: unknown }).ontouchstart = null;
      const before = listenerCount("touchstart");
      document.body.innerHTML = `<spa-manager overscroll-behavior-x="navigate"></spa-manager>`;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      const goSpy = vi.spyOn(history, "go").mockImplementation(() => {});
      expect(manager.overscrollXThreshold).toBe(40);
      expect(listenerCount("touchstart")).toBe(before + 1);
      expect(listenerCount("touchmove")).toBeGreaterThan(0);
      const width = window.innerWidth;

      // left edge → right: back
      touch("touchstart", [{ identifier: 1, clientX: 10, clientY: 50 }]);
      expect(manager.swipeTracker).toEqual({
        identifier: 1,
        startX: 10,
        startY: 50,
      });
      const move = touch("touchmove", [
        { identifier: 1, clientX: 80, clientY: 55 },
      ]);
      expect(move.defaultPrevented).toBe(true);
      expect(goSpy).toHaveBeenLastCalledWith(-1);
      expect(manager.swipeTracker).toBeNull();
      touch("touchend", []);
      expect(manager.swipeTracker).toBeNull();

      // right edge → left: forward
      touch("touchstart", [{ identifier: 2, clientX: width - 5, clientY: 50 }]);
      expect(manager.swipeTracker?.startX).toBe(width - 5);
      touch("touchmove", [{ identifier: 2, clientX: width - 90, clientY: 50 }]);
      expect(goSpy).toHaveBeenLastCalledWith(1);
      expect(manager.swipeTracker).toBeNull();
      touch("touchcancel", []);

      // clamps out-of-viewport start coordinates
      touch("touchstart", [{ identifier: 3, clientX: -20, clientY: -5 }]);
      expect(manager.swipeTracker).toEqual({
        identifier: 3,
        startX: 0,
        startY: 0,
      });
      touch("touchend", []);

      // switching the mode off removes the document listeners
      manager.overscrollBehaviorX = null;
      expect(listenerCount("touchstart")).toBe(before);
      touch("touchstart", [{ identifier: 4, clientX: 10, clientY: 50 }]);
      expect(manager.swipeTracker).toBeNull();
    });

    it("ignores multi-touch, mid-screen starts and unknown touches", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 1,
        configurable: true,
      });
      document.body.innerHTML = `<spa-manager overscroll-behavior-x="navigate" overscroll-x-threshold="30"></spa-manager>`;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      const goSpy = vi.spyOn(history, "go").mockImplementation(() => {});
      expect(manager.overscrollXThreshold).toBe(30);

      // move without a tracker is ignored
      const stray = touch("touchmove", [
        { identifier: 1, clientX: 80, clientY: 50 },
      ]);
      expect(stray.defaultPrevented).toBe(false);

      touch("touchstart", [
        { identifier: 1, clientX: 5, clientY: 50 },
        { identifier: 2, clientX: 50, clientY: 50 },
      ]);
      expect(manager.swipeTracker ?? null).toBeNull();

      touch("touchstart", [{ identifier: 1, clientX: 200, clientY: 50 }]);
      expect(manager.swipeTracker ?? null).toBeNull();

      touch("touchstart", [{ identifier: 1, clientX: 5, clientY: 50 }]);
      expect(manager.swipeTracker?.identifier).toBe(1);
      // a different finger moving does not count
      const other = touch("touchmove", [
        { identifier: 9, clientX: 100, clientY: 50 },
      ]);
      expect(other.defaultPrevented).toBe(false);
      expect(manager.swipeTracker?.identifier).toBe(1);
      expect(goSpy).not.toHaveBeenCalled();
    });

    it("only navigates past the threshold and mostly horizontally", () => {
      (window as unknown as { ontouchstart: unknown }).ontouchstart = null;
      document.body.innerHTML = `<spa-manager overscroll-behavior-x="navigate"></spa-manager>`;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      const goSpy = vi.spyOn(history, "go").mockImplementation(() => {});
      const width = window.innerWidth;

      // tiny horizontal delta: nothing prevented
      touch("touchstart", [{ identifier: 1, clientX: 10, clientY: 50 }]);
      let move = touch("touchmove", [
        { identifier: 1, clientX: 11, clientY: 50 },
      ]);
      expect(move.defaultPrevented).toBe(false);
      // mostly vertical: nothing prevented
      move = touch("touchmove", [{ identifier: 1, clientX: 15, clientY: 200 }]);
      expect(move.defaultPrevented).toBe(false);
      // horizontal but still inside the edge threshold: prevented, no nav
      move = touch("touchmove", [{ identifier: 1, clientX: 30, clientY: 50 }]);
      expect(move.defaultPrevented).toBe(true);
      expect(goSpy).not.toHaveBeenCalled();
      // dragging left from the left edge never navigates
      move = touch("touchmove", [{ identifier: 1, clientX: 0, clientY: 50 }]);
      expect(move.defaultPrevented).toBe(true);
      expect(goSpy).not.toHaveBeenCalled();
      touch("touchend", []);

      // right edge: dragging further right, or left but not past threshold
      touch("touchstart", [{ identifier: 2, clientX: width - 5, clientY: 50 }]);
      touch("touchmove", [{ identifier: 2, clientX: width, clientY: 50 }]);
      touch("touchmove", [{ identifier: 2, clientX: width - 20, clientY: 50 }]);
      expect(goSpy).not.toHaveBeenCalled();
      expect(manager.swipeTracker?.identifier).toBe(2);
      touch("touchend", []);
    });

    it("blocks overscroll without navigating when set to none", () => {
      (window as unknown as { ontouchstart: unknown }).ontouchstart = null;
      document.body.innerHTML = `<spa-manager overscroll-behavior-x="none"></spa-manager>`;
      const goSpy = vi.spyOn(history, "go").mockImplementation(() => {});
      touch("touchstart", [{ identifier: 1, clientX: 10, clientY: 50 }]);
      const move = touch("touchmove", [
        { identifier: 1, clientX: 90, clientY: 50 },
      ]);
      expect(move.defaultPrevented).toBe(true);
      expect(goSpy).not.toHaveBeenCalled();
      expect(q<HTMLSpaManagerElement>("spa-manager").swipeTracker).toEqual(
        expect.objectContaining({ identifier: 1 })
      );
    });
  });
});

describe("utils search params", () => {
  it("compares query strings key by key", () => {
    expect(urlMatchesHref("/a?foo=1", "/a?foo=2")).toBe(false);
    expect(urlMatchesHref("/a?foo=1", "/a?foo=1&bar=2")).toBe(false);
    expect(urlMatchesHref("/a?foo=1&bar=2", "/a?foo=1&bar=3")).toBe(false);
    expect(urlMatchesHref("/a?foo=1&bar=2", "/a?bar=2&foo=1")).toBe(true);
    expect(urlMatchesHref("/a?foo=1", "/a")).toBe(false);
  });
});
