import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

/*
 * `<content-tabs-header>` listens for native `click`. `_handleClick`
 * is sync, but body sync is a parent microtask (`queueMicrotask` ->
 * `_syncBodies`), so tick once before asserting body state.
 */
const clickHeader = async (header: Element) => {
  header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(0);
};

const buildTabs = (attrs = "") =>
  fixture<HTMLContentTabsElement>(
    `<content-tabs ${attrs}>
      <content-tabs-header>Tab 1</content-tabs-header>
      <content-tabs-header>Tab 2</content-tabs-header>
      <content-tabs-body>Content 1</content-tabs-body>
      <content-tabs-body>Content 2</content-tabs-body>
    </content-tabs>`,
  );

const queryParts = (root: HTMLContentTabsElement) => {
  const headers = root.querySelectorAll("content-tabs-header");
  const bodies = root.querySelectorAll("content-tabs-body");
  return {
    header1: headers[0],
    header2: headers[1],
    body1: bodies[0],
    body2: bodies[1],
  };
};

describe("content-tabs", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the clicked tab and closes others (default `single` behavior)", async () => {
    const tabs = buildTabs();
    const { header1, header2, body1, body2 } = queryParts(tabs);

    expect(header1).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);

    await clickHeader(header1);
    expect(header1).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);

    await clickHeader(header2);
    expect(header1).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);
  });

  it("treats `tab-type=single` the same as the default", async () => {
    const tabs = buildTabs(`tab-type="single"`);
    const { header1, header2, body1, body2 } = queryParts(tabs);

    await clickHeader(header1);
    expect(header1).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);

    /* Re-clicking an open header in `single` keeps it open.
       `_handleClick` sets `is-open` true except in `toggle` / `multi`. */
    await clickHeader(header1);
    expect(header1).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);
  });

  it("keeps multiple tabs open with `tab-type=multi`", async () => {
    const tabs = buildTabs(`tab-type="multi"`);
    const { header1, header2, body1, body2 } = queryParts(tabs);

    await clickHeader(header1);
    expect(header1).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);

    await clickHeader(header2);
    expect(header1).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);

    // Click again: this tab off, the other untouched. Parent does not
    // auto-close peers in `multi`.
    await clickHeader(header1);
    expect(header1).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);
  });

  it("closes the clicked tab when re-clicked with `tab-type=toggle`", async () => {
    const tabs = buildTabs(`tab-type="toggle"`);
    const { header1, header2, body1, body2 } = queryParts(tabs);

    await clickHeader(header1);
    expect(header1).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);

    // Same header again -> closes it (toggle off).
    await clickHeader(header1);
    expect(header1).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);

    // Different header -> opens it, closes others (single-style switch).
    await clickHeader(header1);
    await clickHeader(header2);
    expect(header1).dom.to.equalTag(`<content-tabs-header></content-tabs-header>`);
    expect(header2).dom.to.equalTag(`<content-tabs-header is-open></content-tabs-header>`);
    expect(body1).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);
    expect(body2).dom.to.equalTag(`<content-tabs-body is-open></content-tabs-body>`);
  });

  it("pairs a header to its body by `tab-name` when set", async () => {
    const tabs = fixture<HTMLContentTabsElement>(
      `<content-tabs>
        <content-tabs-header tab-name="a">A</content-tabs-header>
        <content-tabs-header tab-name="b">B</content-tabs-header>
        <content-tabs-body tab-name="b">Body B</content-tabs-body>
        <content-tabs-body tab-name="a">Body A</content-tabs-body>
      </content-tabs>`,
    );
    const headerA = tabs.querySelector(
      'content-tabs-header[tab-name="a"]',
    ) as HTMLContentTabsHeaderElement;
    const bodyA = tabs.querySelector(
      'content-tabs-body[tab-name="a"]',
    ) as HTMLContentTabsBodyElement;
    const bodyB = tabs.querySelector(
      'content-tabs-body[tab-name="b"]',
    ) as HTMLContentTabsBodyElement;

    await clickHeader(headerA);
    expect(bodyA).dom.to.equalTag(`<content-tabs-body tab-name="a" is-open></content-tabs-body>`);
    expect(bodyB).dom.to.equalTag(`<content-tabs-body tab-name="b"></content-tabs-body>`);
  });

  it("isolates nested content-tabs from the outer instance", async () => {
    const tabs = fixture<HTMLContentTabsElement>(
      `<content-tabs id="outer">
        <content-tabs-header>Outer 1</content-tabs-header>
        <content-tabs-header>Outer 2</content-tabs-header>
        <content-tabs-body>
          <content-tabs id="inner">
            <content-tabs-header>Inner 1</content-tabs-header>
            <content-tabs-header>Inner 2</content-tabs-header>
            <content-tabs-body>Inner content 1</content-tabs-body>
            <content-tabs-body>Inner content 2</content-tabs-body>
          </content-tabs>
        </content-tabs-body>
        <content-tabs-body>Outer content 2</content-tabs-body>
      </content-tabs>`,
    );
    const outer = tabs;
    const inner = tabs.querySelector("#inner") as HTMLContentTabsElement;
    const outerHeaders = [
      ...outer.querySelectorAll("content-tabs-header"),
    ].filter((h) => h.closest("content-tabs") === outer);
    const innerHeaders = [...inner.querySelectorAll("content-tabs-header")];

    // Inner header only: outer stays closed (parent stops propagation).
    await clickHeader(innerHeaders[1]);
    expect(innerHeaders[0]).dom.to.equalTag(`<content-tabs-header>Inner 1</content-tabs-header>`);
    expect(innerHeaders[1]).dom.to.equalTag(`<content-tabs-header is-open>Inner 2</content-tabs-header>`);
    expect(outerHeaders[0]).dom.to.equalTag(`<content-tabs-header>Outer 1</content-tabs-header>`);
    expect(outerHeaders[1]).dom.to.equalTag(`<content-tabs-header>Outer 2</content-tabs-header>`);
  });
});

describe("content-tabs (provision)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // Provision is computed in the batched body sync, one microtask after
  // connect / a header change
  const settle = () => wait(0);

  it("reads the initial is-open headers after mount", async () => {
    const tabs = fixture<HTMLContentTabsElement>(
      `<content-tabs>
        <content-tabs-header>Tab 1</content-tabs-header>
        <content-tabs-header is-open>Tab 2</content-tabs-header>
        <content-tabs-body>Content 1</content-tabs-body>
        <content-tabs-body is-open>Content 2</content-tabs-body>
      </content-tabs>`,
    );
    await settle();
    expect(tabs.provision).toEqual({
      tabType: null,
      openTabs: [1],
      activeTab: 1,
    });
  });

  it("reports no active tab when none is open", async () => {
    const tabs = buildTabs();
    await settle();
    expect(tabs.provision).toEqual({
      tabType: null,
      openTabs: [],
      activeTab: null,
    });
  });

  it("follows clicks in `single` and emits neutron-provision on each change", async () => {
    const tabs = buildTabs(`tab-type="single"`);
    const { header1, header2 } = queryParts(tabs);
    await settle();
    const provisionSpy = vi.fn();
    tabs.addEventListener("neutron-provision", provisionSpy);

    await clickHeader(header1);
    expect(tabs.provision).toEqual({
      tabType: "single",
      openTabs: [0],
      activeTab: 0,
    });
    expect(provisionSpy).toHaveBeenCalledTimes(1);

    await clickHeader(header2);
    expect(tabs.provision).toEqual({
      tabType: "single",
      openTabs: [1],
      activeTab: 1,
    });
    expect(provisionSpy).toHaveBeenCalledTimes(2);

    // re-clicking the open header in `single` is a no-op, no new object
    const before = tabs.provision;
    await clickHeader(header2);
    expect(tabs.provision).toBe(before);
    expect(provisionSpy).toHaveBeenCalledTimes(2);
  });

  it("lists every open tab in header order in `multi`", async () => {
    const tabs = buildTabs(`tab-type="multi"`);
    const { header1, header2 } = queryParts(tabs);

    await clickHeader(header2);
    expect(tabs.provision).toEqual({
      tabType: "multi",
      openTabs: [1],
      activeTab: 1,
    });

    await clickHeader(header1);
    expect(tabs.provision).toEqual({
      tabType: "multi",
      openTabs: [0, 1],
      activeTab: 0,
    });

    await clickHeader(header1);
    expect(tabs.provision).toEqual({
      tabType: "multi",
      openTabs: [1],
      activeTab: 1,
    });
  });

  it("clears activeTab when the open header is re-clicked in `toggle`", async () => {
    const tabs = buildTabs(`tab-type="toggle"`);
    const { header1 } = queryParts(tabs);

    await clickHeader(header1);
    expect(tabs.provision).toEqual({
      tabType: "toggle",
      openTabs: [0],
      activeTab: 0,
    });

    await clickHeader(header1);
    expect(tabs.provision).toEqual({
      tabType: "toggle",
      openTabs: [],
      activeTab: null,
    });
  });

  it("identifies named headers by tab-name and unnamed ones by index", async () => {
    const tabs = fixture<HTMLContentTabsElement>(
      `<content-tabs tab-type="multi">
        <content-tabs-header tab-name="a" is-open>A</content-tabs-header>
        <content-tabs-header>Positional</content-tabs-header>
        <content-tabs-header tab-name="c">C</content-tabs-header>
        <content-tabs-body tab-name="a">Body A</content-tabs-body>
        <content-tabs-body>Body positional</content-tabs-body>
        <content-tabs-body tab-name="c">Body C</content-tabs-body>
      </content-tabs>`,
    );
    const headers = tabs.querySelectorAll("content-tabs-header");
    await settle();
    expect(tabs.provision).toEqual({
      tabType: "multi",
      openTabs: ["a"],
      activeTab: "a",
    });

    await clickHeader(headers[2]);
    await clickHeader(headers[1]);
    expect(tabs.provision).toEqual({
      tabType: "multi",
      openTabs: ["a", 1, "c"],
      activeTab: "a",
    });

    await clickHeader(headers[0]);
    expect(tabs.provision?.activeTab).toBe(1);
  });

  it("excludes nested groups from the outer provision (and vice versa)", async () => {
    const outer = fixture<HTMLContentTabsElement>(
      `<content-tabs id="outer">
        <content-tabs-header is-open>Outer 1</content-tabs-header>
        <content-tabs-header>Outer 2</content-tabs-header>
        <content-tabs-body is-open>
          <content-tabs id="inner">
            <content-tabs-header>Inner 1</content-tabs-header>
            <content-tabs-header is-open>Inner 2</content-tabs-header>
            <content-tabs-body>Inner content 1</content-tabs-body>
            <content-tabs-body is-open>Inner content 2</content-tabs-body>
          </content-tabs>
        </content-tabs-body>
        <content-tabs-body>Outer content 2</content-tabs-body>
      </content-tabs>`,
    );
    const inner = outer.querySelector("#inner") as HTMLContentTabsElement;
    const innerHeaders = [...inner.querySelectorAll("content-tabs-header")];
    await settle();

    expect(outer.provision).toEqual({
      tabType: null,
      openTabs: [0],
      activeTab: 0,
    });
    expect(inner.provision).toEqual({
      tabType: null,
      openTabs: [1],
      activeTab: 1,
    });

    await clickHeader(innerHeaders[0]);
    expect(inner.provision?.activeTab).toBe(0);
    expect(outer.provision?.activeTab).toBe(0);
    expect(outer.provision?.openTabs).toEqual([0]);
  });
});

describe("content-tabs (unpaired headers)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("tolerates a named header without a matching body", async () => {
    const tabs = fixture<HTMLContentTabsElement>(
      `<content-tabs>
        <content-tabs-header tab-name="a">A</content-tabs-header>
        <content-tabs-header tab-name="orphan">Orphan</content-tabs-header>
        <content-tabs-body tab-name="a">Body A</content-tabs-body>
      </content-tabs>`,
    );
    const headerA = tabs.querySelector('content-tabs-header[tab-name="a"]')!;
    const orphan = tabs.querySelector(
      'content-tabs-header[tab-name="orphan"]',
    )!;
    const bodyA = tabs.querySelector('content-tabs-body[tab-name="a"]')!;

    await clickHeader(orphan);
    expect(orphan).dom.to.equalTag(
      `<content-tabs-header tab-name="orphan" is-open></content-tabs-header>`,
    );
    expect(bodyA).dom.to.equalTag(
      `<content-tabs-body tab-name="a"></content-tabs-body>`,
    );

    await clickHeader(headerA);
    expect(orphan).dom.to.equalTag(
      `<content-tabs-header tab-name="orphan"></content-tabs-header>`,
    );
    expect(bodyA).dom.to.equalTag(
      `<content-tabs-body tab-name="a" is-open></content-tabs-body>`,
    );
  });

  it("tolerates more positional headers than bodies", async () => {
    const tabs = fixture<HTMLContentTabsElement>(
      `<content-tabs>
        <content-tabs-header>One</content-tabs-header>
        <content-tabs-header>Two</content-tabs-header>
        <content-tabs-body>Body one</content-tabs-body>
      </content-tabs>`,
    );
    const { header2, body1 } = queryParts(tabs);
    await clickHeader(header2);
    expect(header2).dom.to.equalTag(
      `<content-tabs-header is-open></content-tabs-header>`,
    );
    expect(body1).dom.to.equalTag(`<content-tabs-body></content-tabs-body>`);
  });
});
