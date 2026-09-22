import { invokeCommand } from "@excom/neutron";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("include-content", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders inline template when activated", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content><template><p>hello</p></template></include-content>`,
    );

    expect(el.isActive).toBeFalsy();

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });

    expect(el).dom.to.equalTag(
      `<include-content is-active did-load></include-content>`,
    );
    expect(el.querySelector("p")?.textContent).toBe("hello");
  });

  it("unrenders content when deactivated", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content><template><p>hello</p></template></include-content>`,
    );

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });

    expect(el.querySelector("p")).not.toBeNull();

    el.isActive = false;
    await wait(0);

    // `did-load` stays set: template remains cached for a fast re-render
    expect(el).dom.to.equalTag(`<include-content did-load></include-content>`);
    expect(el.querySelector("p")).toBeNull();
  });

  it("activates after idle when idleLoad is set", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content idle-load><template><p>idle</p></template></include-content>`,
    );

    expect(el.isActive).toBeFalsy();
    await wait(25);
    expect(el.isActive).toBe(true);
  });

  it("does not activate via idleLoad if already active", () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content is-active idle-load><template><p>idle</p></template></include-content>`,
    );

    expect(el.isActive).toBe(true);
  });

  it("does not activate if idleLoad is removed before idle fires", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content idle-load><template><p>idle</p></template></include-content>`,
    );

    el.idleLoad = false;
    await wait(25);
    expect(el.isActive).toBeFalsy();
  });

  it("creates an observer when lazyLoad is set", () => {
    const observeSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observeSpy;
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>lazy</p></template></include-content>`,
    );

    expect(el.observer).not.toBeNull();
    expect(observeSpy).toHaveBeenCalledWith(el);
  });

  it("creates an observer when lazyUnload is set", () => {
    const observeSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observeSpy;
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-unload><template><p>lazy</p></template></include-content>`,
    );

    expect(el.observer).not.toBeNull();
    expect(observeSpy).toHaveBeenCalledWith(el);
  });

  it("destroys observer when lazyLoad is removed", () => {
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>lazy</p></template></include-content>`,
    );

    expect(el.observer).not.toBeNull();

    el.lazyLoad = false;

    expect(disconnectSpy).toHaveBeenCalled();
    expect(el.observer).toBeNull();
  });

  it("destroys observer on disconnect", async () => {
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>lazy</p></template></include-content>`,
    );

    expect(el.observer).not.toBeNull();

    el.remove();
    await wait(0);

    expect(disconnectSpy).toHaveBeenCalled();
    expect(el.observer).toBeNull();
  });

  it("activates via observer when intersecting with lazyLoad", () => {
    let observerCallback: (entries: Partial<IntersectionObserverEntry>[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: any) {
          observerCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>lazy</p></template></include-content>`,
    );

    expect(el.isActive).toBeFalsy();

    observerCallback!([{ isIntersecting: true }]);

    expect(el.isActive).toBe(true);
  });

  it("deactivates via observer when not intersecting with lazyUnload", () => {
    let observerCallback: (entries: Partial<IntersectionObserverEntry>[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: any) {
          observerCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load lazy-unload><template><p>lazy</p></template></include-content>`,
    );

    observerCallback!([{ isIntersecting: true }]);
    expect(el.isActive).toBe(true);

    observerCallback!([{ isIntersecting: false }]);
    expect(el.isActive).toBe(false);
  });

  it("rebuilds observer on reconnect when lazy options are set", async () => {
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observeSpy;
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>lazy</p></template></include-content>`,
    );

    expect(observeSpy).toHaveBeenCalledTimes(1);

    el.remove();
    await wait(0);
    expect(disconnectSpy).toHaveBeenCalled();

    document.body.appendChild(el);
    await wait(0);
    expect(observeSpy).toHaveBeenCalledTimes(2);
  });

  it("destroys observer when activated without lazyUnload", () => {
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>lazy</p></template></include-content>`,
    );

    expect(el.observer).not.toBeNull();

    el.isActive = true;

    expect(disconnectSpy).toHaveBeenCalled();
    expect(el.observer).toBeNull();
  });

  it("passes observer options from element attributes", () => {
    let receivedOptions: any;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_cb: any, opts: any) {
          receivedOptions = opts;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load observer-root-margin="10px" observer-threshold="0.5" observer-delay="100"></include-content>`,
    );

    expect(receivedOptions.rootMargin).toBe("10px");
    expect(receivedOptions.threshold).toBe(0.5);
    expect(receivedOptions.delay).toBe(100);
  });

  it("uses default observer root margin when not specified", () => {
    let receivedOptions: any;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_cb: any, opts: any) {
          receivedOptions = opts;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load></include-content>`,
    );

    expect(receivedOptions.rootMargin).toBe("-1px -1px -1px -1px");
  });
});

describe("include-content host targeting (host-ref)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("attaches a shadow root and renders into it when host-ref='shadow'", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content host-ref="shadow"><template><p>shadow</p></template></include-content>`,
    );

    expect(el.shadowRoot).not.toBeNull();
    expect(el.renderHost).toBe(el.shadowRoot);

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });

    expect(el.shadowRoot!.querySelector("p")?.textContent).toBe("shadow");
    // light DOM has no rendered <p>, only the original template
    expect(el.querySelector("p")).toBeNull();
    expect(el.querySelector("template")).not.toBeNull();
  });

  it("renders into an author-provided iframe when host-ref='iframe'", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content host-ref="iframe">
        <template><p>iframed</p></template>
        <iframe data-render-host srcdoc="<!doctype html><html><body></body></html>"></iframe>
      </include-content>`,
    );

    const iframe = el.querySelector(
      "iframe[data-render-host]",
    ) as HTMLIFrameElement;
    expect(iframe).not.toBeNull();

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });

    expect(el.renderHost).toBe(iframe.contentDocument!.body);
    expect(
      iframe.contentDocument!.body.querySelector("p")?.textContent,
    ).toBe("iframed");
    // iframe and template stay in light DOM; no rendered <p> outside the iframe
    expect(el.querySelector("iframe[data-render-host]")).toBe(iframe);
    expect(el.querySelector("template")).not.toBeNull();
    expect(Array.from(el.children).some((c) => c.tagName === "P")).toBe(false);
  });

  it("does not create an iframe when host-ref='iframe' and none is provided", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content host-ref="iframe"><template><p>x</p></template></include-content>`,
    );

    expect(el.querySelector("iframe")).toBeNull();
    expect(el.renderHost).toBeNull();

    el.isActive = true;
    await wait(50);

    expect(el.querySelector("iframe")).toBeNull();
    expect(el.querySelector("p")).toBeNull();
  });

  it("renders into a host found by CSS selector when host-ref is a selector", async () => {
    document.body.innerHTML = `
      <div id="render-target"></div>
      <include-content host-ref="#render-target">
        <template><p>elsewhere</p></template>
      </include-content>
    `;
    const el = document.querySelector(
      "include-content",
    ) as HTMLIncludeContentElement;
    const target = document.getElementById("render-target")!;

    expect(el.renderHost).toBe(target);

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });

    expect(target.querySelector("p")?.textContent).toBe("elsewhere");
    expect(el.querySelector("p")).toBeNull();
  });

  it("keeps the author iframe when host-ref switches away from 'iframe'", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content host-ref="iframe">
        <template><p>x</p></template>
        <iframe data-render-host srcdoc="<!doctype html><html><body></body></html>"></iframe>
      </include-content>`,
    );

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });
    const iframe = el.querySelector(
      "iframe[data-render-host]",
    ) as HTMLIFrameElement;
    expect(iframe.contentDocument!.body.querySelector("p")).not.toBeNull();

    await waitForEvent(el, "include-content-did-render", () => {
      el.hostRef = "shadow";
    });

    // Author-owned iframe stays; its body is cleared and content moves to shadow
    expect(el.querySelector("iframe[data-render-host]")).toBe(iframe);
    expect(iframe.contentDocument!.body.querySelector("p")).toBeNull();
    expect(el.shadowRoot!.querySelector("p")?.textContent).toBe("x");
  });

  it("re-targets rendered content when host-ref changes from light DOM to shadow", async () => {
    const el = fixture<HTMLIncludeContentElement>(
      `<include-content><template><p>moves</p></template></include-content>`,
    );

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });
    // initial render goes into light DOM
    expect(el.querySelector("p")?.textContent).toBe("moves");
    expect(el.shadowRoot).toBeNull();

    await waitForEvent(el, "include-content-did-render", () => {
      el.hostRef = "shadow";
    });

    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.querySelector("p")?.textContent).toBe("moves");
    expect(el.querySelector("p")).toBeNull();
  });
});

describe("include-content reload", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("re-fetches and re-renders when --reload is invoked while active", async () => {
    let nthCall = 0;
    spyFetch(() => ({
      body: `<p>render-${++nthCall}</p>`,
      headers: new Headers({ "content-type": "text/html" }),
    }));

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content template-ref="/reload-refetch.html"></include-content>`,
    );

    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });
    expect(el.querySelector("p")?.textContent).toBe("render-1");

    await waitForEvent(el, "include-content-did-render", () => {
      invokeCommand(el, "--reload");
    });
    expect(el.querySelector("p")?.textContent).toBe("render-2");
  });

  it("does nothing when --reload is invoked while inactive", async () => {
    const fetchSpy = spyFetch({
      body: "<p>x</p>",
      headers: new Headers({ "content-type": "text/html" }),
    });

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content template-ref="/reload-inactive.html"></include-content>`,
    );

    // not active -> no initial fetch
    await wait(10);
    expect(fetchSpy).not.toHaveBeenCalled();

    invokeCommand(el, "--reload");
    await wait(10);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el.isLoading).toBeFalsy();
    expect(el.didLoad).toBeFalsy();
  });

  it("clears the previous didLoad/_persistedTree before reloading", async () => {
    let nthCall = 0;
    spyFetch(() => ({
      body: `<p>v${++nthCall}</p>`,
      headers: new Headers({ "content-type": "text/html" }),
    }));

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content template-ref="/reload-clears.html"></include-content>`,
    );
    await waitForEvent(el, "include-content-did-render", () => {
      el.isActive = true;
    });
    expect(el.didLoad).toBe(true);

    // Reload handler should reset; wait for the next `did-render`.
    await waitForEvent(el, "include-content-did-render", () => {
      invokeCommand(el, "--reload");
    });
    expect(el.didLoad).toBe(true);
    expect(el.querySelector("p")?.textContent).toBe("v2");
  });
});

describe("include-content idle / lazy edge cases", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("idle-load schedules activation through requestIdleCallback when available", () => {
    const idleSpy = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idleSpy);

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content idle-load><template><p>idle</p></template></include-content>`,
    );

    expect(idleSpy).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 17,
    });
    expect(el.isActive).toBe(true);
  });

  it("resolves observer-root as a selector for the IntersectionObserver root", () => {
    let receivedOptions: any;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_cb: any, opts: any) {
          receivedOptions = opts;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    document.body.innerHTML = `
      <section id="ic-scroll-root">
        <include-content lazy-load observer-root="#ic-scroll-root"></include-content>
      </section>
    `;

    expect(receivedOptions.root).toBe(
      document.getElementById("ic-scroll-root"),
    );
  });

  it("keeps the existing observer when a second lazy option is set", () => {
    const observeSpy = vi.fn();
    let constructed = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor() {
          constructed++;
        }
        observe = observeSpy;
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load></include-content>`,
    );
    const observer = el.observer;
    expect(constructed).toBe(1);

    el.lazyUnload = true;
    expect(constructed).toBe(1);
    expect(el.observer).toBe(observer);
    expect(observeSpy).toHaveBeenCalledTimes(1);
  });

  it("recreates the observer when lazy options are cleared and re-set", () => {
    let constructed = 0;
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor() {
          constructed++;
        }
        observe = vi.fn();
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load lazy-unload></include-content>`,
    );
    expect(constructed).toBe(1);

    el.lazyLoad = false;
    // lazy-unload still set: observer survives
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(el.observer).not.toBeNull();

    el.lazyUnload = false;
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(el.observer).toBeNull();

    el.lazyLoad = true;
    expect(constructed).toBe(2);
    expect(el.observer).not.toBeNull();
  });

  it("rebuilds the observer on reconnect when only lazy-unload is set", async () => {
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observeSpy;
        disconnect = disconnectSpy;
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-unload><template><p>lazy</p></template></include-content>`,
    );
    expect(observeSpy).toHaveBeenCalledTimes(1);

    el.remove();
    await wait(0);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(el.observer).toBeNull();

    document.body.appendChild(el);
    await wait(0);
    expect(observeSpy).toHaveBeenCalledTimes(2);
    expect(el.observer).not.toBeNull();
  });

  it("ignores an intersection when already active", () => {
    let observerCallback: (entries: Partial<IntersectionObserverEntry>[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: any) {
          observerCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load lazy-unload is-active><template><p>on</p></template></include-content>`,
    );
    expect(el.isActive).toBe(true);
    expect(el.observer).not.toBeNull();

    observerCallback!([{ isIntersecting: true }]);
    expect(el.isActive).toBe(true);
  });

  it("stays active when leaving the viewport without lazy-unload", () => {
    let observerCallback: (entries: Partial<IntersectionObserverEntry>[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: any) {
          observerCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>on</p></template></include-content>`,
    );
    observerCallback!([{ isIntersecting: true }]);
    expect(el.isActive).toBe(true);

    observerCallback!([{ isIntersecting: false }]);
    expect(el.isActive).toBe(true);
  });

  it("treats a hidden element as off screen", () => {
    let observerCallback: (entries: Partial<IntersectionObserverEntry>[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: any) {
          observerCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load lazy-unload><template><p>hidden</p></template></include-content>`,
    );
    el.checkVisibility = () => false;

    observerCallback!([{ isIntersecting: true }]);
    expect(el.isActive).toBeFalsy();

    el.checkVisibility = () => true;
    observerCallback!([{ isIntersecting: true }]);
    expect(el.isActive).toBe(true);

    el.checkVisibility = () => false;
    observerCallback!([{ isIntersecting: true }]);
    expect(el.isActive).toBe(false);
  });

  it("treats a missing checkVisibility as visible", () => {
    let observerCallback: (entries: Partial<IntersectionObserverEntry>[]) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: any) {
          observerCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );

    const el = fixture<HTMLIncludeContentElement>(
      `<include-content lazy-load><template><p>legacy</p></template></include-content>`,
    );
    (el as any).checkVisibility = undefined;

    observerCallback!([{ isIntersecting: true }]);
    expect(el.isActive).toBe(true);
  });
});
