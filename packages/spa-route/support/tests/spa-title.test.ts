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
import "../../index";
import { kitRouter } from "@excom/kit-router";

if (!document.startViewTransition) {
  /*
   * Shim: like a browser, `finished` settles only after the update callback.
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

type RouterState = { id: string; url: string; isInit?: boolean };
type RouterInternals = {
  states: RouterState[];
  currentStateId: string | null;
  currentTempData: { move: null | string; event?: unknown };
  routes: unknown[];
};
const router = kitRouter as unknown as RouterInternals & typeof kitRouter;

/** The page's own `<title>` — what an untitled route must fall back to. */
const PAGE_TITLE = "Page own title";

/** Put the singleton router back to a cold-load state on `url`. */
const resetRouter = (url = "/") => {
  history.replaceState(null, "", url);
  router.states = [{ id: "init", url, isInit: true }];
  router.currentStateId = null;
  router.currentTempData = { move: null };
};

/** Emulate the browser landing on a known history entry (back / forward). */
const popstate = (state: RouterState) => {
  history.replaceState({ id: state.id }, "", state.url);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

const q = <T extends Element>(selector: string) =>
  document.querySelector(selector) as T;
const qa = <T extends Element>(selector: string) =>
  Array.from(document.querySelectorAll(selector)) as T[];

/** Navigate and wait for the manager to settle. */
const navigate = (manager: Element, trigger: () => void) =>
  waitForEvent(manager, "spa-manager-rendered", trigger);

/**
 * Hard-load `url` with `html` as the document: routes match at connect, so
 * nothing can be awaited before mounting — settle on the title instead.
 */
const coldLoad = async (url: string, html: string, title: string) => {
  resetRouter(url);
  document.body.innerHTML = html;
  await vi.waitFor(() => expect(document.title).toBe(title));
  // let the batch that follows the unbatched first paint drain
  await wait(5);
};

describe("spa-route document-title", () => {
  beforeEach(() => {
    resetRouter();
    document.title = PAGE_TITLE;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    router.routes = [];
    vi.restoreAllMocks();
    resetRouter();
  });

  const twoRoutes = `
    <spa-manager>
      <spa-route route-href="/company" document-title="Experimental Company">
        <template><p>company</p></template>
      </spa-route>
      <spa-route route-href="/docs"><template><p>docs</p></template></spa-route>
    </spa-manager>
  `;

  it("titles a cold load, with no link in the way", async () => {
    await coldLoad("/company", twoRoutes, "Experimental Company");

    expect(q<HTMLSpaRouteElement>("spa-route").isActive).toBe(true);
    expect(document.title).toBe("Experimental Company");
  });

  it("restores the page's own title when no active route has one", async () => {
    await coldLoad("/company", twoRoutes, "Experimental Company");
    const manager = q<HTMLSpaManagerElement>("spa-manager");

    await navigate(manager, () => kitRouter.pushState({ url: "/docs" }));
    expect(document.title).toBe(PAGE_TITLE);

    // and back on the titled route it returns
    await navigate(manager, () => kitRouter.pushState({ url: "/company" }));
    expect(document.title).toBe("Experimental Company");
  });

  it("swaps between two titled routes, back included", async () => {
    const html = `
      <spa-manager>
        <spa-route route-href="/a" document-title="Alpha"><template>A</template></spa-route>
        <spa-route route-href="/b" document-title="Beta"><template>B</template></spa-route>
      </spa-manager>
    `;
    await coldLoad("/a", html, "Alpha");
    const manager = q<HTMLSpaManagerElement>("spa-manager");

    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(document.title).toBe("Beta");

    await navigate(manager, () => popstate(router.states[0]!));
    expect(document.title).toBe("Alpha");
  });

  it("lets a nested route outrank its ancestor, and hands the title back", async () => {
    const html = `
      <spa-manager>
        <!-- a regex, not match-nested: that one only matches nested paths -->
        <spa-route route-regex="^/parent" document-title="Parent">
          <template>
            <spa-manager>
              <spa-route route-href="/parent/child" document-title="Child">
                <template><p id="child">child</p></template>
              </spa-route>
            </spa-manager>
          </template>
        </spa-route>
      </spa-manager>
    `;
    await coldLoad("/parent", html, "Parent");
    const innerManager = qa<HTMLSpaManagerElement>("spa-manager")[1]!;

    // the inner manager settles this one; it hands the title to the outermost
    await navigate(innerManager, () =>
      kitRouter.pushState({ url: "/parent/child" })
    );
    expect(q("#child")).not.toBeNull();
    expect(document.title).toBe("Child");

    await navigate(innerManager, () => kitRouter.pushState({ url: "/parent" }));
    expect(q("#child")).toBeNull();
    expect(document.title).toBe("Parent");
  });

  it("follows document-title rewritten on the route already on screen", async () => {
    await coldLoad("/company", twoRoutes, "Experimental Company");
    const route = q<HTMLSpaRouteElement>("spa-route");

    route.setAttribute("document-title", "Renamed");
    await vi.waitFor(() => expect(document.title).toBe("Renamed"));

    // dropping it falls back to the page's own title
    route.removeAttribute("document-title");
    await vi.waitFor(() => expect(document.title).toBe(PAGE_TITLE));
  });

  it("ignores document-title on an inactive route", async () => {
    await coldLoad("/docs", twoRoutes, PAGE_TITLE);
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    const [company, docs] = qa<HTMLSpaRouteElement>("spa-route");

    expect(docs!.isActive).toBe(true);
    company!.setAttribute("document-title", "Not on screen");
    await wait(5);

    expect(document.title).toBe(PAGE_TITLE);
    // nothing claimed the title, so the page's own was never captured
    expect(manager._defaultTitle ?? null).toBeNull();
  });

  it("titles the is-fallback route", async () => {
    const html = `
      <spa-manager>
        <spa-route route-href="/known" document-title="Known"><template>K</template></spa-route>
        <spa-route route-regex=".*" is-fallback document-title="Not found">
          <template>404</template>
        </spa-route>
      </spa-manager>
    `;
    await coldLoad("/known", html, "Known");
    const manager = q<HTMLSpaManagerElement>("spa-manager");

    await navigate(manager, () => kitRouter.pushState({ url: "/nowhere" }));
    expect(qa<HTMLSpaRouteElement>("spa-route")[1]!.isActive).toBe(true);
    expect(document.title).toBe("Not found");
  });

  it("leaves document.title alone when no route is titled", async () => {
    const html = `
      <spa-manager>
        <spa-route route-href="/a"><template>A</template></spa-route>
        <spa-route route-href="/b"><template>B</template></spa-route>
      </spa-manager>
    `;
    await coldLoad("/a", html, PAGE_TITLE);
    const manager = q<HTMLSpaManagerElement>("spa-manager");
    // an app titling the page itself must not be clobbered
    document.title = "Set by the app";

    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));

    expect(document.title).toBe("Set by the app");
    expect(manager._defaultTitle ?? null).toBeNull();
  });
});
