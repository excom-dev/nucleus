import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyFetch,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";
import {
  installViewTransition,
  StandInTransition,
  trackUnhandledRejections,
} from "./helpers";
import { KitLogger } from "@excom/kit-logger";
import { kitRouter } from "@excom/kit-router";

type RouterState = {
  id: string;
  url: string;
  isInit?: boolean;
  scrollX?: number;
  scrollY?: number;
};
type RouterInternals = {
  states: RouterState[];
  currentStateId: string | null;
  currentTempData: { move: null | string; event?: unknown };
  routes: unknown[];
};
const router = kitRouter as unknown as RouterInternals & typeof kitRouter;

/** Put the singleton router back to a cold load of `url` (`state` extras: a saved offset = reload). */
const resetRouter = (url = "/", state: Partial<RouterState> = {}) => {
  history.replaceState({ id: "init" }, "", url);
  router.states = [{ id: "init", url, isInit: true, ...state }];
  router.currentStateId = "init";
  router.currentTempData = { move: null };
};

/** Emulate the browser landing on a known history entry (back / forward). */
const popstate = (state: RouterState) => {
  history.replaceState({ id: state.id }, "", state.url);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

const navigate = (manager: Element, trigger: () => void) =>
  waitForEvent(manager, "spa-manager-rendered", trigger);

const captureEvent = (target: EventTarget, type: string) => {
  const events: Event[] = [];
  target.addEventListener(type, (e) => events.push(e));
  return events;
};

const q = <T extends Element>(selector: string) =>
  document.querySelector(selector) as T;
const qa = <T extends Element>(selector: string) =>
  Array.from(document.querySelectorAll(selector)) as T[];

const html = document.documentElement;
/** The person scrolls to `top`. */
const scrollPage = (top: number) => (html.scrollTop = top);
const nextFrames = async (count = 2) => {
  for (let i = 0; i < count; i++) {
    await new Promise(requestAnimationFrame);
  }
};

const twoRoutes = `
  <spa-manager>
    <spa-route route-href="/a" document-title="Alpha"><template><p id="a">A</p></template></spa-route>
    <spa-route route-href="/b" document-title="Beta"><template><p id="b">B</p></template></spa-route>
  </spa-manager>
`;

/** Elements scrolled into view, in order. */
const intoView = () => {
  const targets: Element[] = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element
  ) {
    targets.push(this);
  });
  return targets;
};

let vt: ReturnType<typeof installViewTransition>;

beforeEach(() => {
  resetRouter();
  vt = installViewTransition();
  document.title = "Page";
});
afterEach(() => {
  document.body.innerHTML = "";
  router.routes = [];
  vi.restoreAllMocks();
  vt.restore();
  resetRouter();
  html.scrollTop = 0;
  html.scrollLeft = 0;
});

describe("spa-manager scroll", () => {
  it("writes once per navigation, inside the update, after the routes rendered", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/a"><template><p id="a">A</p></template></spa-route>
        <spa-route route-href="/slow" template-ref="/slow-view.html"></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    spyFetch(
      {
        status: 200,
        body: `<p id="slow">slow</p>`,
        headers: new Headers({ "content-type": "text/html" }),
      } as never,
      30
    );
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    expect(history.scrollRestoration).toBe("manual");
    scrollPage(300);

    const scrollTo = window.scrollTo.bind(window);
    const writes: Array<{
      options: ScrollToOptions;
      transitions: number;
      phase?: StandInTransition["phase"];
      rendered: boolean;
    }> = [];
    vi.spyOn(window, "scrollTo").mockImplementation(((
      options: ScrollToOptions
    ) => {
      writes.push({
        options,
        transitions: vt.calls.length,
        phase: vt.calls.at(-1)?.phase,
        rendered: !!q("#slow") || !!q("#a"),
      });
      scrollTo(options);
    }) as typeof window.scrollTo);

    // the remote view renders late: the reset waits for it
    await navigate(manager, () => kitRouter.pushState({ url: "/slow" }));
    expect(vt.calls).toHaveLength(1);
    expect(writes).toEqual([
      {
        options: { left: 0, top: 0, behavior: "instant" },
        transitions: 1,
        phase: "updating",
        rendered: true,
      },
    ]);

    // back: nothing moves before the transition starts; then /a's offset
    await navigate(manager, () => popstate(router.states[1]!));
    expect(vt.calls).toHaveLength(2);
    expect(writes[1]).toEqual({
      options: { left: 0, top: 300, behavior: "instant" },
      transitions: 2,
      phase: "updating",
      rendered: true,
    });
    expect(writes).toHaveLength(2);
    expect(window.scrollY).toBe(300);
  });

  it("restores a reload and leaves a fresh page load alone", async () => {
    const scrollToSpy = vi.spyOn(window, "scrollTo");
    resetRouter("/a", { scrollX: 0, scrollY: 640 });
    document.body.innerHTML = twoRoutes;
    await waitForEvent(q("spa-manager"), "spa-manager-rendered");
    expect(scrollToSpy).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 640,
      behavior: "instant",
    });

    document.body.innerHTML = "";
    router.routes = [];
    scrollToSpy.mockClear();
    // a first visit (or a `#fragment` link) keeps the browser's own position
    resetRouter("/a#section");
    document.body.innerHTML = twoRoutes;
    await waitForEvent(q("spa-manager"), "spa-manager-rendered");
    expect(q("#a")).not.toBeNull();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("sets manual scroll restoration while the outermost manager is connected", async () => {
    await wait(0);
    history.scrollRestoration = "auto";
    document.body.innerHTML = `
      <spa-manager><section><spa-manager></spa-manager></section></spa-manager>
    `;
    const [outer, inner] = qa<HTMLSpaManagerElement>("spa-manager");
    expect(history.scrollRestoration).toBe("manual");
    inner!.remove();
    await wait(0);
    expect(history.scrollRestoration).toBe("manual");
    outer!.remove();
    await wait(0);
    expect(history.scrollRestoration).toBe("auto");
  });

  it("keeps manual restoration while any outermost manager is connected", async () => {
    await wait(0);
    history.scrollRestoration = "auto";
    const pair = `<spa-manager id="one"></spa-manager><spa-manager id="two"></spa-manager>`;
    document.body.innerHTML = `<spa-manager></spa-manager>`;
    // replaced at once: the old owner disconnects a microtask later
    document.body.innerHTML = pair;
    await wait(0);
    expect(history.scrollRestoration).toBe("manual");
    for (const order of [["#one", "#two"], ["#two", "#one"]]) {
      document.body.innerHTML = pair;
      q(order[0]!).remove();
      await wait(0);
      expect(history.scrollRestoration).toBe("manual");
      q(order[1]!).remove();
      await wait(0);
      expect(history.scrollRestoration).toBe("auto");
    }
  });

  it("leaves a cold load's write to the first update when routes connect later", async () => {
    const targets = intoView();
    const scrollToSpy = vi.spyOn(window, "scrollTo");
    const later = async (html: string) => {
      document.body.innerHTML = `<spa-manager></spa-manager>`;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      await wait(5);
      await navigate(manager, () =>
        manager.insertAdjacentHTML("beforeend", html)
      );
    };
    resetRouter("/doc#part");
    await later(
      `<spa-route route-href="/doc"><template><h2 id="part">Part</h2></template></spa-route>`
    );
    expect(targets).toEqual([q("#part")]);

    document.body.innerHTML = "";
    router.routes = [];
    resetRouter("/a", { scrollX: 0, scrollY: 640 });
    await later(`<spa-route route-href="/a"><template>A</template></spa-route>`);
    expect(scrollToSpy).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 640,
      behavior: "instant",
    });
  });

  it("writes no title or scroll for an owner removed mid-update", async () => {
    document.body.innerHTML = `
      <spa-manager render-timeout="50">
        <spa-route route-href="/a" document-title="Alpha"><template>A</template></spa-route>
        <spa-route route-href="/slow" document-title="Slow" ready-on="never"><template>S</template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    const scrollToSpy = vi.spyOn(window, "scrollTo");
    kitRouter.pushState({ url: "/slow" });
    await wait(5);
    expect(manager._updating).toBe(true);
    manager.remove();
    await wait(80);
    expect(manager._updating).toBe(false);
    expect(document.title).toBe("Alpha");
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  describe("a restored offset", () => {
    let maxTop = 0;
    beforeEach(() => {
      maxTop = 100;
      Object.defineProperty(html, "scrollHeight", {
        configurable: true,
        get: () => maxTop + 500,
      });
      vi.spyOn(window, "scrollTo").mockImplementation(((
        options: ScrollToOptions
      ) => {
        html.scrollTop = Math.min(options.top ?? window.scrollY, maxTop);
      }) as typeof window.scrollTo);
    });
    afterEach(() => {
      delete (html as unknown as Record<string, unknown>).scrollHeight;
    });

    /** /a scrolled to 900 when it was long, then /b, then back to /a. */
    const backToA = async () => {
      document.body.innerHTML = twoRoutes;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
      scrollPage(900);
      await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
      await navigate(manager, () => popstate(router.states[1]!));
      expect(manager._heldScroll).toEqual(
        expect.objectContaining({ top: 900 })
      );
      return manager;
    };

    it("follows a page still too short, and stays held once reached", async () => {
      const manager = await backToA();
      expect(window.scrollY).toBe(100);
      maxTop = 400;
      await nextFrames();
      expect(window.scrollY).toBe(400);
      maxTop = 2000;
      await nextFrames();
      expect(window.scrollY).toBe(900);
      expect(manager._heldScroll).not.toBeNull();
    });

    it("is written again when content above renders late and shifts the page", async () => {
      maxTop = 2000;
      await backToA();
      expect(window.scrollY).toBe(900);
      // content above lands; scroll anchoring moves the viewport with it
      maxTop = 2178;
      scrollPage(1078);
      await nextFrames();
      expect(window.scrollY).toBe(900);
    });

    it.each(["wheel", "touchstart", "pointerdown", "keydown"])(
      "is released by %s",
      async (type) => {
        const manager = await backToA();
        window.dispatchEvent(new Event(type));
        expect(manager._heldScroll ?? null).toBeNull();
        maxTop = 2000;
        await nextFrames();
        expect(window.scrollY).toBe(100);
      }
    );

    it("is released by a scroll the page's layout did not cause", async () => {
      maxTop = 2000;
      const manager = await backToA();
      // a scrollbar drag, or the app scrolling: no input event, same layout
      scrollPage(500);
      await nextFrames();
      expect(manager._heldScroll ?? null).toBeNull();
      maxTop = 2500;
      await nextFrames();
      expect(window.scrollY).toBe(500);
    });

    it("holds only the restored axis when the other resets", async () => {
      maxTop = 2000;
      document.body.innerHTML = twoRoutes.replace(
        `route-href="/a"`,
        `route-href="/a" scroll-reset-x="push replace back"`
      );
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
      scrollPage(900);
      await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
      await navigate(manager, () => popstate(router.states[1]!));
      expect(window.scrollTo).toHaveBeenLastCalledWith({
        left: 0,
        top: 900,
        behavior: "instant",
      });
      expect(manager._heldScroll).toEqual({ top: 900, behavior: "instant" });
    });

    it("is released by the next navigation", async () => {
      const manager = await backToA();
      await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
      expect(manager._heldScroll ?? null).toBeNull();
      expect(window.scrollY).toBe(0);
    });

    it("is released after about 2 seconds", async () => {
      const manager = await backToA();
      const now = performance.now();
      vi.spyOn(performance, "now").mockReturnValue(now + 2001);
      await nextFrames();
      expect(manager._heldScroll ?? null).toBeNull();
      maxTop = 2000;
      await nextFrames();
      expect(window.scrollY).toBe(100);
    });

    it("is not kept for a reset", async () => {
      maxTop = 2000;
      const manager = await backToA();
      await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
      expect(manager._heldScroll ?? null).toBeNull();
    });
  });

  describe("fragments", () => {
    const docRoutes = `
      <spa-manager>
        <spa-route route-href="/a"><template><p id="a">A</p></template></spa-route>
        <spa-route route-href="/doc"><template><h2 id="part">Part</h2></template></spa-route>
      </spa-manager>
    `;
    it("scrolls a push to its #fragment once the route rendered it, instead of the reset", async () => {
      const targets = intoView();
      document.body.innerHTML = docRoutes;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
      const scrollToSpy = vi.spyOn(window, "scrollTo");
      await navigate(manager, () => kitRouter.pushState({ url: "/doc#part" }));
      expect(targets).toEqual([q("#part")]);
      expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it("scrolls a fresh page load to a #fragment a route renders, and writes nothing when it is missing", async () => {
      const targets = intoView();
      const scrollToSpy = vi.spyOn(window, "scrollTo");
      resetRouter("/doc#part");
      document.body.innerHTML = docRoutes;
      await waitForEvent(q("spa-manager"), "spa-manager-rendered");
      expect(targets).toEqual([q("#part")]);

      document.body.innerHTML = "";
      router.routes = [];
      resetRouter("/doc#missing");
      document.body.innerHTML = docRoutes;
      await waitForEvent(q("spa-manager"), "spa-manager-rendered");
      expect(targets).toHaveLength(1);
      expect(scrollToSpy).not.toHaveBeenCalled();
    });
  });

  describe("a navigation no route reacts to", () => {
    it("restores a hash-only back without an update or a transition", async () => {
      document.body.innerHTML = twoRoutes;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
      await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
      scrollPage(300);
      const rendered = captureEvent(manager, "spa-manager-rendered");
      const scrollToSpy = vi.spyOn(window, "scrollTo");
      kitRouter.pushState({ url: "/b#below" });
      scrollPage(700);
      popstate(router.states.at(-2)!);
      await wait(5);
      expect(scrollToSpy).toHaveBeenCalledExactlyOnceWith({
        left: 0,
        top: 300,
        behavior: "instant",
      });
      expect(window.scrollY).toBe(300);
      expect(rendered).toHaveLength(0);
      expect(vt.calls).toHaveLength(1);
    });

    it("leaves no write due for a later update", async () => {
      document.body.innerHTML = `
        <spa-manager>
          <spa-route route-href="/list"><template><p>list</p></template></spa-route>
        </spa-manager>
      `;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      await navigate(manager, () => kitRouter.pushState({ url: "/list" }));
      const scrollToSpy = vi.spyOn(window, "scrollTo");
      kitRouter.pushState({ url: "/list#top" });
      await wait(5);
      expect(scrollToSpy).not.toHaveBeenCalled();

      // a provision-only move keeps its place
      await navigate(manager, () => kitRouter.pushState({ url: "/list?page=2" }));
      // an update that is no navigation (a route added late) writes nothing
      await navigate(manager, () =>
        manager.insertAdjacentHTML(
          "beforeend",
          `<spa-route route-href="/list"><template><p id="late">late</p></template></spa-route>`
        )
      );
      expect(q("#late")).not.toBeNull();
      expect(scrollToSpy).not.toHaveBeenCalled();
    });
  });
});

describe("spa-manager transition", () => {
  it("gives nested managers one transition and one scroll write; a route rendered by the update joins it", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/home"><template>Home</template></spa-route>
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
    `;
    const outer = q<HTMLSpaManagerElement>("spa-manager");
    const layout = qa<HTMLSpaRouteElement>("spa-route")[1]!;
    await navigate(outer, () => kitRouter.pushState({ url: "/home" }));
    const scrollToSpy = vi.spyOn(window, "scrollTo");

    await navigate(outer, () => kitRouter.pushState({ url: "/users/42" }));
    expect(q("#detail")).not.toBeNull();
    expect(vt.calls).toHaveLength(1);
    expect(vt.calls[0]!.isSkipped).toBe(false);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    const inner = q<HTMLSpaManagerElement>("#layout spa-manager");
    const innerRendered = captureEvent(inner, "spa-manager-rendered");
    const outerRendered = captureEvent(outer, "spa-manager-rendered");
    await navigate(outer, () =>
      kitRouter.pushState({ url: "/users/42/edit" })
    );
    await wait(5);
    // one per update at the owner; the nested manager gets its own
    expect(outerRendered).toHaveLength(1);
    expect(q("#edit")).not.toBeNull();
    expect(q("#detail")).toBeNull();
    expect(vt.calls).toHaveLength(2);
    expect(vt.calls[1]!.isSkipped).toBe(false);
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
    // the nested manager still announces its routes' update
    expect(innerRendered.filter((e) => e.target === inner)).toHaveLength(1);
    // the layout's provision follows the child path
    expect(layout.provision?.active.url).toBe("/users/42/edit");
  });

  it("settles a transition a newer one skips, without an unhandled rejection", async () => {
    const unhandled = trackUnhandledRejections();
    try {
      document.body.innerHTML = twoRoutes;
      const manager = q<HTMLSpaManagerElement>("spa-manager");
      await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
      // e.g. a Quark `@view-transition` starting right after ours
      manager.addEventListener(
        "spa-manager-transition",
        () => document.startViewTransition({ update: () => {} } as never),
        { once: true }
      );
      await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
      await wait(5);
      expect(vt.calls[0]!.isSkipped).toBe(true);
      expect(q("#b")).not.toBeNull();
      expect(document.title).toBe("Beta");
      expect(manager.isTransitioning).toBe(false);
      expect(unhandled.reasons).toEqual([]);
    } finally {
      unhandled.stop();
    }
  });

  it("does not transition with reduced motion, read per navigation", async () => {
    let reduce = true;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({ matches: reduce && query.includes("reduce") }) as MediaQueryList
    );
    const scrollToSpy = vi.spyOn(window, "scrollTo");
    document.body.innerHTML = twoRoutes;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));

    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(vt.calls).toHaveLength(0);
    expect(document.title).toBe("Beta");
    expect(scrollToSpy).toHaveBeenCalledTimes(2);

    reduce = false;
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    expect(vt.calls).toHaveLength(1);
  });

  it("does not transition in a hidden page", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.body.innerHTML = twoRoutes;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(vt.calls).toHaveLength(0);
    expect(q("#b")).not.toBeNull();
    expect(document.title).toBe("Beta");
  });

  it("titles the page and announces the update without a transition", async () => {
    document.body.innerHTML = twoRoutes;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    manager.noTransition = true;
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    expect(document.title).toBe("Alpha");
    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(document.title).toBe("Beta");
    await navigate(manager, () => popstate(router.states[1]!));
    expect(document.title).toBe("Alpha");

    // no View Transition API at all
    vt.restore();
    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(document.title).toBe("Beta");
    expect(vt.calls).toHaveLength(0);
  });

  it("delays only an update that animates with transition-delay", async () => {
    let reduce = false;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({ matches: reduce && query.includes("reduce") }) as MediaQueryList
    );
    document.body.innerHTML = twoRoutes;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    manager.transitionDelay = 5000;
    // first paint: not delayed (`navigate` gives up after 1s)
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    reduce = true;
    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(vt.calls).toHaveLength(0);

    reduce = false;
    kitRouter.pushState({ url: "/a" });
    await wait(5);
    expect(manager.transitionDelayId).not.toBeNull();
    expect(vt.calls).toHaveLength(0);
    // drop the pending delay
    await navigate(manager, () => manager.updateRoutes(false));
    expect(manager.transitionDelayId ?? null).toBeNull();

    // nor the first paint, even with `transition-first-render`
    document.body.innerHTML = "";
    router.routes = [];
    resetRouter("/a");
    document.body.innerHTML = twoRoutes.replace(
      "<spa-manager>",
      `<spa-manager transition-delay="5000" transition-first-render>`
    );
    await waitForEvent(q("spa-manager"), "spa-manager-rendered");
    expect(vt.calls).toHaveLength(1);
  });

  it("falls back to a plain update when startViewTransition throws", async () => {
    document.body.innerHTML = twoRoutes;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    vi.spyOn(document, "startViewTransition").mockImplementation(() => {
      // e.g. an engine without transition types
      throw new TypeError("parameter 1 is not of type 'Function'");
    });
    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(q("#b")).not.toBeNull();
    expect(document.title).toBe("Beta");
    expect(manager.isTransitioning).toBe(false);
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    expect(q("#a")).not.toBeNull();
  });

  it("runs a navigation started by a spa-manager-rendered listener", async () => {
    document.body.innerHTML = twoRoutes;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    manager.addEventListener(
      "spa-manager-rendered",
      () => kitRouter.pushState({ url: "/b" }),
      { once: true }
    );
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    await waitForEvent(manager, "spa-manager-rendered");
    expect(q("#b")).not.toBeNull();
    expect(q("#a")).toBeNull();
  });

  it("does not wait for a route that cannot render", async () => {
    document.body.innerHTML = `
      <spa-manager render-timeout="5000">
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/portal" host-ref="#nowhere"><template><p>x</p></template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    // settles long before `render-timeout`
    await navigate(manager, () => kitRouter.pushState({ url: "/portal" }));
    expect(qa<HTMLSpaRouteElement>("spa-route")[1]!.isActive).toBe(true);
  });

  it("gives a chain of late joins one render-timeout", async () => {
    document.body.innerHTML = `
      <spa-manager render-timeout="150">
        <spa-route route-href="/chain" match-nested ready-on="never">
          <template>
            <spa-route route-href="/chain" match-nested ready-on="never">
              <template><p id="deep">deep</p></template>
            </spa-route>
          </template>
        </spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const started = performance.now();
    await navigate(manager, () => kitRouter.pushState({ url: "/chain" }));
    const took = performance.now() - started;
    expect(q("#deep")).not.toBeNull();
    expect(took).toBeGreaterThanOrEqual(140);
    // one round each would be 300 ms
    expect(took).toBeLessThan(280);
  });

  it("does not wait for a failed view", async () => {
    vi.spyOn(KitLogger, "error").mockImplementation(() => {});
    document.body.innerHTML = `
      <spa-manager render-timeout="5000">
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/broken" template-ref="#does-not-exist"></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const scrollToSpy = vi.spyOn(window, "scrollTo");
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    // settles long before `render-timeout`
    await navigate(manager, () => kitRouter.pushState({ url: "/broken" }));
    expect(qa<HTMLSpaRouteElement>("spa-route")[1]!.isError).toBe(true);
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
  });
});

describe("spa-manager has-rendered", () => {
  /** A remote view landing `ms` after its request. A URL per test: the cache is page-wide. */
  const lateView = (ms = 50) =>
    spyFetch(
      {
        status: 200,
        body: `<p id="late">late</p>`,
        headers: new Headers({ "content-type": "text/html" }),
      } as never,
      ms
    );

  /** `read()` as each View Transition's update callback resolves. */
  const atUpdateEnd = (read: () => boolean) => {
    const seen: boolean[] = [];
    const start = document.startViewTransition.bind(document);
    vi.spyOn(document, "startViewTransition").mockImplementation((options) => {
      const { update, types } = options as StartViewTransitionOptions;
      return start({
        types,
        update: async () => {
          await update?.();
          seen.push(read());
        },
      });
    });
    return seen;
  };

  /** `read()` whenever `spa-manager-rendered` reaches a manager in `root`. */
  const atRendered = (root: Element, read: () => boolean) => {
    const seen: boolean[] = [];
    // capture: a nested manager's event does not bubble
    root.addEventListener("spa-manager-rendered", () => seen.push(read()), true);
    return seen;
  };

  it("is set once the first render landed, inside the update", async () => {
    lateView();
    resetRouter("/late");
    const has = () => q("spa-manager").hasAttribute("has-rendered");
    const inUpdate = atUpdateEnd(has);
    document.body.innerHTML = `
      <spa-manager transition-first-render>
        <spa-route route-href="/late" template-ref="/late-first.html"></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const rendered = atRendered(manager, has);
    await wait(10);
    // the view is still on its way: a loading shell stays
    expect(q("#late")).toBeNull();
    expect(has()).toBe(false);
    await waitForEvent(manager, "spa-manager-rendered");
    expect(q("#late")).not.toBeNull();
    expect(vt.calls).toHaveLength(1);
    expect(inUpdate).toEqual([true]);
    expect(rendered).toEqual([true]);
  });

  /* A nested manager that is connected before its route matches: happy-dom
     connects children before their parent, so one a layout renders misses
     its routes' first events. */
  it("reaches a nested manager with its routes' render, not with their events", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/home"><template>Home</template></spa-route>
        <aside>
          <spa-manager>
            <spa-route route-href="/users/:id" template-ref="/late-detail.html"></spa-route>
          </spa-manager>
        </aside>
      </spa-manager>
    `;
    const outer = q<HTMLSpaManagerElement>("spa-manager");
    const inner = q<HTMLSpaManagerElement>("aside spa-manager");
    await navigate(outer, () => kitRouter.pushState({ url: "/home" }));
    lateView();
    const has = () => inner.hasAttribute("has-rendered");
    const inUpdate = atUpdateEnd(has);
    const rendered = atRendered(outer, has);

    kitRouter.pushState({ url: "/users/42" });
    await wait(10);
    // its route joined the update; the view has not landed
    expect(inner._joined).toBe(true);
    expect(q("#late")).toBeNull();
    expect(has()).toBe(false);
    await waitForEvent(outer, "spa-manager-rendered");
    expect(q("#late")).not.toBeNull();
    expect(inUpdate).toEqual([true]);
    // the nested manager's event, then the owner's
    expect(rendered).toEqual([true, true]);
  });

  it("is set at the end of an update whose deadline passed", async () => {
    resetRouter("/stuck");
    document.body.innerHTML = `
      <spa-manager render-timeout="100">
        <spa-route route-href="/stuck" ready-on="never"><template>S</template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const has = () => manager.hasAttribute("has-rendered");
    const rendered = atRendered(manager, has);
    await wait(5);
    expect(manager._updating).toBe(true);
    expect(has()).toBe(false);
    await waitForEvent(manager, "spa-manager-rendered");
    expect(rendered).toEqual([true]);
  });

  it("has no attemptTransitionDebounced", () => {
    document.body.innerHTML = `<spa-manager></spa-manager>`;
    expect("attemptTransitionDebounced" in q("spa-manager")).toBe(false);
  });
});

describe("spa-route query", () => {
  it("provisions a reuse route again on a query-only move, without a transition", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/list"><template><input id="keep" /></template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const route = q<HTMLSpaRouteElement>("spa-route");
    await navigate(manager, () => kitRouter.pushState({ url: "/list?page=1" }));
    const input = q("#keep");
    expect(route.provision?.query).toEqual({ page: "1" });
    const provisions = captureEvent(route, "spa-route-provision");
    scrollPage(400);
    const scrollToSpy = vi.spyOn(window, "scrollTo");

    await navigate(manager, () => kitRouter.pushState({ url: "/list?page=2" }));
    expect(provisions).toHaveLength(1);
    expect(route.provision?.query).toEqual({ page: "2" });
    expect(route.provision?.active.url).toBe("/list?page=2");
    expect(q("#keep")).toBe(input);
    // only a provision changed: nothing to animate, no reset
    expect(vt.calls).toHaveLength(0);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(400);

    // a hash-only move does not provision
    kitRouter.pushState({ url: "/list?page=2#top" });
    await wait(5);
    expect(provisions).toHaveLength(1);
  });

  it("keeps the provision current after A, B, A in one task", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/list"><template>list</template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const route = q<HTMLSpaRouteElement>("spa-route");
    await navigate(manager, () => kitRouter.pushState({ url: "/list?q=a" }));
    await navigate(manager, () => {
      kitRouter.pushState({ url: "/list?q=b" });
      kitRouter.pushState({ url: "/list?q=a" });
    });
    expect(route.provision?.query).toEqual({ q: "a" });
    expect(route.provision?.active.url).toBe("/list?q=a");
  });

  it("renders a refresh route again on a query-only move, not on a hash-only one", async () => {
    document.body.innerHTML = `
      <spa-manager>
        <spa-route route-href="/search" same-route="refresh"><template><input id="fresh" /></template></spa-route>
      </spa-manager>
    `;
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const route = q<HTMLSpaRouteElement>("spa-route");
    await navigate(manager, () => kitRouter.pushState({ url: "/search?q=a" }));
    const first = q("#fresh");
    scrollPage(400);
    const scrollToSpy = vi.spyOn(window, "scrollTo");

    await navigate(manager, () => kitRouter.pushState({ url: "/search?q=b" }));
    const second = q("#fresh");
    expect(second).not.toBe(first);
    expect(route.provision?.query).toEqual({ q: "b" });
    // rendered again: the push resets
    expect(scrollToSpy).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 0,
      behavior: "instant",
    });

    const renders = captureEvent(route, "spa-route-did-render");
    kitRouter.pushState({ url: "/search?q=b#top" });
    await wait(5);
    expect(renders).toHaveLength(0);
    expect(q("#fresh")).toBe(second);
  });
});
