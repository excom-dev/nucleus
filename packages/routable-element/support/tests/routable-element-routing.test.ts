import { RoutableElement } from "../../index";
import { Neutron } from "@excom/neutron";
import { KitRoute, kitRouter } from "@excom/kit-router";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const TAG = "routable-routing-test";

// Records every `routeChanged` call so tests can assert on router payloads.
const routeChangedSpy = vi.fn();

const PathAware = Neutron.compose([
  RoutableElement,
  Neutron({
    tag: TAG,
    props: {
      isActive: Boolean,
    },
  }),
]).defineMethods({
  routeChanged: (element, data) => {
    routeChangedSpy(element, data);
    return { isActive: !!data.match };
  },
});

if (!customElements.get(TAG)) {
  PathAware.define();
}

type TestElement = HTMLElement & {
  routeHref: string | null;
  routeRegex: string | null;
  matchNested: boolean;
  routeInstance: KitRoute | null;
  isActive: boolean;
  isMoving: boolean;
  wasMounted: boolean;
};

describe("RoutableElement routing", () => {
  let onSpy: ReturnType<typeof vi.spyOn>;
  let offSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    history.replaceState(null, "", "/");
    routeChangedSpy.mockClear();
    onSpy = vi.spyOn(kitRouter, "on");
    offSpy = vi.spyOn(kitRouter, "off");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    history.replaceState(null, "", "/");
  });

  it("registers a path route on connect and reacts to URL changes", async () => {
    const el = fixture<TestElement>(
      `<${TAG} route-href="/users/:id"></${TAG}>`
    );
    await wait(0);
    expect(el.routeInstance).toBeInstanceOf(KitRoute);
    expect(el.routeInstance!.key).toBe("/users/:id");
    expect(onSpy).toHaveBeenCalledWith(el.routeInstance);
    // registering immediately reports the current (non-matching) URL
    expect(routeChangedSpy).toHaveBeenLastCalledWith(
      el,
      expect.objectContaining({ match: null, params: null })
    );
    expect(el.isActive).toBe(false);

    kitRouter.pushState({ url: "/users/7" });
    expect(routeChangedSpy).toHaveBeenLastCalledWith(
      el,
      expect.objectContaining({
        params: { id: "7" },
        match: expect.arrayContaining(["/users/7", "7"]),
        move: "push",
      })
    );
    expect(el.isActive).toBe(true);

    kitRouter.pushState({ url: "/elsewhere" });
    expect(el.isActive).toBe(false);
  });

  it("does not register a route when neither route-href nor route-regex is set", async () => {
    const el = fixture<TestElement>(`<${TAG}></${TAG}>`);
    await wait(0);
    expect(el.routeInstance ?? null).toBeNull();
    expect(onSpy).not.toHaveBeenCalled();
    expect(routeChangedSpy).not.toHaveBeenCalled();
    el.remove();
    await wait(0);
    expect(offSpy).not.toHaveBeenCalled();
  });

  it("registers a regex route", async () => {
    const el = fixture<TestElement>(
      `<${TAG} route-regex="^/docs(/.*)?$"></${TAG}>`
    );
    await wait(0);
    expect(el.routeInstance!.key).toBeInstanceOf(RegExp);
    expect(el.routeInstance!.regex.source).toBe(
      new RegExp("^/docs(/.*)?$").source
    );
    expect(el.isActive).toBe(false);
    kitRouter.pushState({ url: "/docs/intro" });
    expect(el.isActive).toBe(true);
  });

  it("honours match-nested", async () => {
    const nested = fixture<TestElement>(
      `<${TAG} route-href="/docs" match-nested></${TAG}>`
    );
    const exact = fixture<TestElement>(`<${TAG} route-href="/docs"></${TAG}>`);
    await wait(0);
    expect(nested.routeInstance!.opts).toEqual({ matchNested: true });
    expect(exact.routeInstance!.opts).toEqual({ matchNested: false });
    kitRouter.pushState({ url: "/docs/intro" });
    expect(nested.isActive).toBe(true);
    expect(exact.isActive).toBe(false);
  });

  it("swaps the router registration when route-href changes", async () => {
    const el = fixture<TestElement>(`<${TAG} route-href="/a"></${TAG}>`);
    await wait(0);
    const first = el.routeInstance!;
    expect(first.key).toBe("/a");

    el.routeHref = "/b";
    await wait(0);
    const second = el.routeInstance!;
    expect(second).not.toBe(first);
    expect(second.key).toBe("/b");
    expect(offSpy).toHaveBeenCalledWith(first);
    expect(onSpy).toHaveBeenCalledWith(second);
  });

  it("switches from a path route to a regex route", async () => {
    const el = fixture<TestElement>(`<${TAG} route-href="/a"></${TAG}>`);
    await wait(0);
    const pathRoute = el.routeInstance!;

    el.routeHref = null;
    el.routeRegex = "^/z";
    await wait(0);
    expect(offSpy).toHaveBeenCalledWith(pathRoute);
    expect(el.routeInstance!.key).toBeInstanceOf(RegExp);
    expect((el.routeInstance!.key as RegExp).source).toBe(
      new RegExp("^/z").source
    );
  });

  it("unregisters when route-href is cleared", async () => {
    const el = fixture<TestElement>(`<${TAG} route-href="/a"></${TAG}>`);
    await wait(0);
    const route = el.routeInstance!;
    onSpy.mockClear();

    el.routeHref = null;
    await wait(0);
    expect(el.routeInstance).toBeNull();
    expect(offSpy).toHaveBeenCalledWith(route);
    expect(onSpy).not.toHaveBeenCalled();
  });

  it("unregisters on disconnect and re-registers on reconnect", async () => {
    const el = fixture<TestElement>(`<${TAG} route-href="/a"></${TAG}>`);
    await wait(0);
    const first = el.routeInstance!;

    el.remove();
    await wait(0);
    expect(el.routeInstance).toBeNull();
    expect(offSpy).toHaveBeenCalledWith(first);

    onSpy.mockClear();
    document.body.appendChild(el);
    await wait(0);
    expect(el.wasMounted).toBe(true);
    const second = el.routeInstance!;
    expect(second).toBeInstanceOf(KitRoute);
    expect(second).not.toBe(first);
    expect(onSpy).toHaveBeenCalledWith(second);
  });

  it("re-registers a regex route on reconnect", async () => {
    const el = fixture<TestElement>(`<${TAG} route-regex="^/r"></${TAG}>`);
    await wait(0);
    const first = el.routeInstance!;
    expect(first).toBeInstanceOf(KitRoute);

    el.remove();
    await wait(0);
    onSpy.mockClear();
    document.body.appendChild(el);
    await wait(0);
    const second = el.routeInstance!;
    expect(second).not.toBe(first);
    expect(second.key).toBeInstanceOf(RegExp);
    expect(onSpy).toHaveBeenCalledWith(second);
  });

  it("does nothing on reconnect when no pattern is set", async () => {
    const el = fixture<TestElement>(`<${TAG}></${TAG}>`);
    await wait(0);
    el.remove();
    await wait(0);
    document.body.appendChild(el);
    await wait(0);
    expect(el.routeInstance ?? null).toBeNull();
    expect(onSpy).not.toHaveBeenCalled();
  });

  it("keeps the registration when the element is moved synchronously", async () => {
    const el = fixture<TestElement>(`<${TAG} route-href="/a"></${TAG}>`);
    await wait(0);
    const route = el.routeInstance!;
    offSpy.mockClear();
    onSpy.mockClear();

    const holder = document.createElement("div");
    document.body.appendChild(holder);
    // remove + append in the same task is a "move" (isMoving), not a
    // disconnect: the route must stay registered exactly once
    el.remove();
    holder.appendChild(el);
    await wait(0);
    expect(el.routeInstance).toBe(route);
    expect(offSpy).not.toHaveBeenCalled();
    expect(onSpy).not.toHaveBeenCalled();
  });
});
