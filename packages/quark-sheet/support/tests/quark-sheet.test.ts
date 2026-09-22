import { invokeCommand } from "@excom/neutron";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";

const vi = (globalThis as any).vi;

const quarkSrc = `main[data-test="abc"] span { data-test: "def"; }`;

describe("quark-sheet", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("defines the quark-sheet custom element", () => {
    expect(customElements.get("quark-sheet")).toBeTruthy();
  });

  it("builds quark from inline text content on connect", () => {
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet>${quarkSrc}</quark-sheet>`,
    );

    expect(el).dom.to.equalTag(
      `<quark-sheet is-success></quark-sheet>`,
    );
    expect(el.quarkInstance).toBeDefined();
  });

  it("does not build quark when text content is empty", () => {
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet></quark-sheet>`,
    );

    expect(el.isSuccess).toBeFalsy();
    expect(el.quarkInstance).toBeFalsy();
  });

  it("fetches and builds quark from srcUrl", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve({
          text: () => Promise.resolve(quarkSrc),
        } as Response),
      );

    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet src-url="/public/my-sheet"></quark-sheet>`,
    );

    expect(el).dom.to.equalTag(
      `<quark-sheet is-loading src-url="/public/my-sheet"></quark-sheet>`,
    );

    await waitForEvent(el, "quark-sheet-success");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/public/my-sheet",
      expect.any(Object),
    );
    expect(el).dom.to.equalTag(
      `<quark-sheet is-success src-url="/public/my-sheet"></quark-sheet>`,
    );
    expect(el.quarkInstance).toBeDefined();
  });

  it("re-fetches on the --reload command, bypassing the shared text cache", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls++;
      return Promise.resolve({
        text: () => Promise.resolve(quarkSrc),
      } as Response);
    });
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet src-url="/public/reload-sheet"></quark-sheet>`,
    );
    await waitForEvent(el, "quark-sheet-success");
    const first = el.quarkInstance;
    expect(calls).toBe(1);

    invokeCommand(el, "--reload");
    // the handler runs in a microtask after the dispatch
    await Promise.resolve();
    expect(el.isLoading).toBe(true);
    await waitForEvent(el, "quark-sheet-success");
    expect(calls).toBe(2);
    expect(el.quarkInstance).not.toBe(first);
    expect(el).dom.to.equalTag(
      `<quark-sheet is-success src-url="/public/reload-sheet"></quark-sheet>`,
    );

    // without src-url the command is a no-op
    const inline = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet>${quarkSrc}</quark-sheet>`,
    );
    invokeCommand(inline, "--reload");
    await wait(0);
    expect(inline.isLoading).toBeFalsy();
    expect(calls).toBe(2);
  });

  it("unregisters previous quark when srcUrl changes", async () => {
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet>${quarkSrc}</quark-sheet>`,
    );

    const qi = el.quarkInstance!;
    vi.spyOn(qi, "unregister");

    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve({
        text: () =>
          Promise.resolve(quarkSrc + " extra-rule { autofocus: ''; }"),
      } as Response),
    );

    el.textContent = "";
    el.srcUrl = "/public/new-sheet";

    await waitForEvent(el, "quark-sheet-success");

    expect(qi.unregister).toHaveBeenCalled();
    expect(el.quarkInstance).not.toBe(qi);
  });

  it("sets error state when src fetch rejects", async () => {
    KitLogger.suppress();

    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.reject(new Error("network error")),
    );

    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet src-url="/bad-url"></quark-sheet>`,
    );

    await waitForEvent(el, "quark-sheet-error");

    KitLogger.unsuppress();

    expect(el).dom.to.equalTag(
      `<quark-sheet is-error src-url="/bad-url"></quark-sheet>`,
    );
  });

  it("emits quark-sheet-loading when loading starts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );

    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet></quark-sheet>`,
    );

    const loadingPromise = waitForEvent(el, "quark-sheet-loading", () => {
      el.srcUrl = "/slow-url";
    });

    await loadingPromise;

    expect(el.isLoading).toBe(true);
  });

  it("re-registers quark when reconnected", () => {
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet>${quarkSrc}</quark-sheet>`,
    );

    const qi = el.quarkInstance!;
    vi.spyOn(qi, "register");

    el.remove();
    document.body.appendChild(el);

    expect(qi.register).toHaveBeenCalled();
  });

  it("unregisters quark on disconnect", async () => {
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet>${quarkSrc}</quark-sheet>`,
    );

    const qi = el.quarkInstance!;
    vi.spyOn(qi, "unregister");

    el.remove();
    await wait(0);

    expect(qi.unregister).toHaveBeenCalled();
  });

  it("scopes rules to the host by default (backwards compatible)", async () => {
    const root = fixture<HTMLElement>(
      `<div>
        <section>
          <quark-sheet>[bind-x] { data-hit: ""; }</quark-sheet>
          <span bind-x></span>
        </section>
        <aside><span bind-x></span></aside>
      </div>`,
    );
    const el = root.querySelector("quark-sheet") as HTMLQuarkSheetElement;
    await wait(0);
    await wait(0);

    expect(el.quarkInstance!.options.isScoped).toBe(true);
    expect(
      root.querySelector("section [bind-x]")?.hasAttribute("data-hit"),
    ).toBe(true);
    expect(root.querySelector("aside [bind-x]")?.hasAttribute("data-hit")).toBe(
      false,
    );
  });

  it("is-global runs top-level rules in the root context", async () => {
    const root = fixture<HTMLElement>(
      `<div>
        <section>
          <quark-sheet is-global>[bind-x] { data-hit: ""; }</quark-sheet>
          <span bind-x></span>
        </section>
        <aside><span bind-x></span></aside>
      </div>`,
    );
    const el = root.querySelector("quark-sheet") as HTMLQuarkSheetElement;
    await wait(0);
    await wait(0);

    expect(el.quarkInstance!.options.isScoped).toBe(false);
    expect(root.querySelectorAll("[bind-x][data-hit]")).toHaveLength(2);
  });

  it("quark mutates desired elements", async () => {
    // Sheet + target must share a parent: Quark scopes rules to
    // the `@scope` wrapper anchored at the sheet's host.
    const root = fixture<HTMLElement>(
      `<section>
        <quark-sheet>${quarkSrc}</quark-sheet>
        <main data-test="abc">
          <span></span>
        </main>
      </section>`,
    );

    // Attribute paints are scheduled on the next macrotask.
    await wait(0);
    expect(root.querySelector("span")?.getAttribute("data-test")).toBe("def");
  });

  it("sets error state and emits quark-sheet-error when inline text fails to parse", async () => {
    KitLogger.suppress();
    const el = document.createElement("quark-sheet") as HTMLQuarkSheetElement;
    el.textContent = "a { b: ?; }";
    try {
      await waitForEvent(el, "quark-sheet-error", () =>
        document.body.appendChild(el),
      );
    } finally {
      KitLogger.unsuppress();
    }

    expect(el).dom.to.equalTag(`<quark-sheet is-error></quark-sheet>`);
    expect(el.isSuccess).toBeFalsy();
    expect(el.quarkInstance).toBeFalsy();
  });

  it("sets error state when fetched text fails to parse", async () => {
    KitLogger.suppress();
    spyFetch({ status: 200, body: "a { b: ?; }" });
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet src-url="/public/broken-sheet"></quark-sheet>`,
    );
    try {
      await waitForEvent(el, "quark-sheet-error");
    } finally {
      KitLogger.unsuppress();
    }

    expect(el).dom.to.equalTag(
      `<quark-sheet is-error src-url="/public/broken-sheet"></quark-sheet>`,
    );
    expect(el.srcText).toBe("a { b: ?; }");
    expect(el.srcPromise).toBeFalsy();
    expect(el.quarkInstance).toBeFalsy();
  });

  it("rebuilds and re-registers quark when is-global toggles", () => {
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet>${quarkSrc}</quark-sheet>`,
    );
    const scoped = el.quarkInstance!;
    expect(scoped.options.isScoped).toBe(true);
    vi.spyOn(scoped, "unregister");

    el.isGlobal = true;

    const global = el.quarkInstance!;
    expect(scoped.unregister).toHaveBeenCalledTimes(1);
    expect(global).not.toBe(scoped);
    expect(global.options.isScoped).toBe(false);
    expect(global.isRegistered).toBe(true);
    expect(el).dom.to.equalTag(
      `<quark-sheet is-global is-success></quark-sheet>`,
    );

    el.isGlobal = false;

    expect(global.isRegistered).toBe(false);
    expect(el.quarkInstance).not.toBe(global);
    expect(el.quarkInstance!.options.isScoped).toBe(true);
    expect(el.quarkInstance!.isRegistered).toBe(true);
  });

  it("does not build quark when is-global toggles without sheet text", () => {
    const el = fixture<HTMLQuarkSheetElement>(`<quark-sheet></quark-sheet>`);

    el.isGlobal = true;

    expect(el.quarkInstance).toBeFalsy();
    expect(el.isSuccess).toBeFalsy();
    expect(el.isError).toBeFalsy();
  });

  it("defers building quark while a fetch is pending", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );
    const el = fixture<HTMLQuarkSheetElement>(
      `<quark-sheet src-url="/public/never-resolves"></quark-sheet>`,
    );
    expect(el.isLoading).toBe(true);

    el.srcText = quarkSrc;
    await wait(0);

    expect(el.quarkInstance).toBeFalsy();
    expect(el).dom.to.equalTag(
      `<quark-sheet is-loading src-url="/public/never-resolves"></quark-sheet>`,
    );
  });

  it("re-registers the same quark against the new parent when moved", () => {
    const root = fixture<HTMLElement>(
      `<div>
        <section data-host="a"><quark-sheet>${quarkSrc}</quark-sheet></section>
        <section data-host="b"></section>
      </div>`,
    );
    const el = root.querySelector("quark-sheet") as HTMLQuarkSheetElement;
    const hostA = root.querySelector('[data-host="a"]')!;
    const hostB = root.querySelector('[data-host="b"]')!;
    const qi = el.quarkInstance!;
    expect(qi.host.deref()).toBe(hostA);
    vi.spyOn(qi, "unregister");
    vi.spyOn(qi, "register");

    hostB.appendChild(el);

    expect(qi.unregister).toHaveBeenCalledTimes(1);
    expect(qi.register).toHaveBeenCalledTimes(1);
    expect(el.quarkInstance).toBe(qi);
    expect(qi.isRegistered).toBe(true);
    expect(qi.host.deref()).toBe(hostB);
  });
});
