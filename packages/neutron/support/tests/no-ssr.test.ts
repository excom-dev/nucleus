import { Neutron } from "../../src/neutron";
import { NeutronError } from "../../src/neutron-error";
import type { ServerRender } from "@excom/kit-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/nucleus-test";

const ssr = globalThis as { __NUCLEUS_SSR__?: ServerRender };

let count = 0;
const uniqueTag = () => `no-ssr-el-${++count}`;

/** An element whose every reaction is a spy; its first mount renders a `<section>`. */
const define = (config: { ssr?: boolean } = {}) => {
  const tag = uniqueTag();
  const spies = {
    connected: vi.fn(),
    disconnected: vi.fn(),
    label: vi.fn(),
    ping: vi.fn(),
  };
  Neutron({
    tag,
    props: { label: String },
    renderRoot: { tag: "section" },
    ...config,
  })
    .onConnected(spies.connected)
    .onDisconnected(spies.disconnected)
    .onPropChanged("label", (_, previous) => spies.label(previous))
    .onEvent("ping", spies.ping)
    .define();
  return { tag, ...spies };
};

const ping = (el: Element) => el.dispatchEvent(new Event("ping"));

afterEach(() => {
  delete ssr.__NUCLEUS_SSR__;
  document.body.innerHTML = "";
});

describe("no-ssr: during a prerender", () => {
  beforeEach(() => {
    ssr.__NUCLEUS_SSR__ = { responses: [] };
  });

  it("an element with no-ssr does not mount: no reaction, no render, its markup as authored", async () => {
    const host = define();
    const el = fixture<any>(
      `<${host.tag} no-ssr label="a"><p>Loading…</p></${host.tag}>`
    );
    el.label = "b";
    ping(el);
    await wait(0);
    expect(el.isMounted).toBe(false);
    expect(el.wasMounted).toBe(false);
    expect(host.connected).not.toHaveBeenCalled();
    expect(host.label).not.toHaveBeenCalled();
    expect(host.ping).not.toHaveBeenCalled();
    expect(el.innerHTML).toBe("<p>Loading…</p>");
    expect(el.getAttribute("label")).toBe("b");
  });

  it("no-ssr on an ancestor keeps it out too", () => {
    const host = define();
    const el = fixture(`<div no-ssr><${host.tag}></${host.tag}></div>`)
      .firstElementChild as any;
    expect(el.isMounted).toBe(false);
    expect(host.connected).not.toHaveBeenCalled();
    expect(el.children).toHaveLength(0);
  });

  it("ssr: false keeps every instance out, not what it holds, and writes no attribute", () => {
    const host = define({ ssr: false });
    const child = define();
    const el = fixture<any>(
      `<${host.tag}><${child.tag}></${child.tag}></${host.tag}>`
    );
    expect(el.isMounted).toBe(false);
    expect(host.connected).not.toHaveBeenCalled();
    expect(el.hasAttribute("no-ssr")).toBe(false);
    expect(el.firstElementChild.isMounted).toBe(true);
    expect(child.connected).toHaveBeenCalledTimes(1);
  });

  it("no-ssr written late unmounts it at once, as a disconnect; its reactions wait", async () => {
    const host = define();
    const el = fixture<any>(`<${host.tag}></${host.tag}>`);
    expect(el.isMounted).toBe(true);
    el.setAttribute("no-ssr", "");
    expect(el.isMounted).toBe(false);
    expect(host.disconnected).toHaveBeenCalledTimes(1);
    el.label = "late";
    ping(el);
    await wait(0);
    expect(host.label).not.toHaveBeenCalled();
    expect(host.ping).not.toHaveBeenCalled();
    expect(host.disconnected).toHaveBeenCalledTimes(1);

    // removed: it mounts again, after what changed meanwhile reacted
    el.removeAttribute("no-ssr");
    expect(el.isMounted).toBe(true);
    expect(host.label).toHaveBeenCalledExactlyOnceWith({ label: null });
    expect(host.connected).toHaveBeenCalledTimes(2);
    ping(el);
    expect(host.ping).toHaveBeenCalledTimes(1);
    // one render root: a remount, not a first mount
    expect(el.children).toHaveLength(1);
  });

  it("kept out from the start, it mounts for the first time once no-ssr goes", () => {
    const host = define();
    const el = fixture<any>(`<${host.tag} no-ssr label="a"></${host.tag}>`);
    el.setAttribute("no-ssr", "still");
    expect(el.isMounted).toBe(false);
    el.removeAttribute("no-ssr");
    expect(el.isMounted).toBe(true);
    expect(host.connected).toHaveBeenCalledTimes(1);
    expect(host.label).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ label: null })
    );
    expect(el.querySelector(":scope > section")).not.toBeNull();
  });

  it("kept out by an ancestor, it stays out when its own no-ssr goes", () => {
    const host = define();
    const el = fixture(
      `<div no-ssr><${host.tag} no-ssr></${host.tag}></div>`
    ).firstElementChild as any;
    el.removeAttribute("no-ssr");
    expect(el.isMounted).toBe(false);
    expect(host.connected).not.toHaveBeenCalled();
  });

  it("kept out, a disconnect does nothing; moved out of no-ssr, it mounts for the first time", async () => {
    const host = define();
    const el = fixture(`<div no-ssr><${host.tag}></${host.tag}></div>`)
      .firstElementChild as any;
    document.body.append(el);
    await wait(0);
    expect(el.isMounted).toBe(true);
    expect(host.connected).toHaveBeenCalledTimes(1);
    expect(host.disconnected).not.toHaveBeenCalled();
    expect(el.children).toHaveLength(1);
  });

  it("moved into a no-ssr subtree, a mounted element unmounts once", async () => {
    const host = define();
    const el = fixture<any>(`<${host.tag}></${host.tag}>`);
    const keptOut = fixture(`<div no-ssr></div>`);
    keptOut.append(el);
    expect(el.isMounted).toBe(false);
    await wait(0);
    expect(host.disconnected).toHaveBeenCalledTimes(1);
    expect(host.connected).toHaveBeenCalledTimes(1);
  });

  it("a hold taken in its own onConnected outlasts that handler's batch", () => {
    const tag = uniqueTag();
    const changed = vi.fn();
    Neutron({ tag, props: { label: String } })
      .onConnected((el: any) => {
        if (!el.wasMounted) el.setAttribute("no-ssr", "");
      })
      .onPropChanged("label", changed)
      .define();
    const el = fixture<any>(`<${tag} label="a"></${tag}>`);
    expect(el.isMounted).toBe(false);
    el.label = "b";
    expect(changed).not.toHaveBeenCalled();
    el.removeAttribute("no-ssr");
    expect(el.isMounted).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("a hold taken in its own onPropChanged (a move under no-ssr) outlasts that handler's batch", () => {
    const tag = uniqueTag();
    const counted = vi.fn();
    const keptOut = fixture(`<div no-ssr></div>`);
    Neutron({ tag, props: { label: String, count: Number } })
      .onPropChanged("label", (el: any) => {
        if (el.label === "away") keptOut.append(el);
      })
      .onPropChanged("count", counted)
      .define();
    const el = fixture<any>(`<${tag}></${tag}>`);
    el.label = "away";
    expect(el.parentElement).toBe(keptOut);
    expect(el.isMounted).toBe(false);
    el.count = 1;
    expect(counted).not.toHaveBeenCalled();
    document.body.append(el);
    expect(el.isMounted).toBe(true);
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it("no-ssr written while disconnected waits for the next connect", () => {
    const host = define();
    const el = document.createElement(host.tag) as any;
    el.setAttribute("no-ssr", "");
    document.body.append(el);
    expect(el.isMounted).toBe(false);
    expect(host.connected).not.toHaveBeenCalled();
  });
});

describe("no-ssr: outside a prerender", () => {
  it("changes nothing: each form mounts as on a cold load", async () => {
    const host = define();
    const off = define({ ssr: false });
    const own = fixture<any>(`<${host.tag} no-ssr></${host.tag}>`);
    const nested = fixture(`<div no-ssr><${host.tag}></${host.tag}></div>`)
      .firstElementChild as any;
    const perTag = fixture<any>(`<${off.tag}></${off.tag}>`);
    expect([own, nested, perTag].map((el) => el.isMounted)).toEqual([
      true,
      true,
      true,
    ]);
    const el = fixture<any>(`<${host.tag}></${host.tag}>`);
    el.setAttribute("no-ssr", "");
    own.removeAttribute("no-ssr");
    await wait(0);
    expect([el.isMounted, own.isMounted]).toEqual([true, true]);
    expect(host.connected).toHaveBeenCalledTimes(3);
    expect(host.disconnected).not.toHaveBeenCalled();
  });
});

describe("ssr: config", () => {
  beforeEach(() => {
    ssr.__NUCLEUS_SSR__ = { responses: [] };
  });

  /** Whether an instance of builders stating `ssr` (`null`: omitted), composed in order, mounts. */
  const mountsComposed = (...stated: (boolean | null)[]) => {
    const tag = uniqueTag();
    Neutron.compose(
      stated.map((value) =>
        Neutron({ tag, props: {}, ...(value === null ? {} : { ssr: value }) })
      ) as any
    ).define();
    return fixture<any>(`<${tag}></${tag}>`).isMounted;
  };

  it("mounts when no builder states it", () => {
    expect(mountsComposed(null)).toBe(true);
    expect(mountsComposed(null, null)).toBe(true);
  });

  it.each([
    [[false, null], false],
    [[false, true], true],
    [[true, false], false],
    [[false, null, null], false],
    [[false, true, null], true],
    [[true, false, null], false],
    [[false, null, true], true],
  ])(
    "composes the last builder that states it, the others inheriting (null: omitted): %j mounts %s",
    (stated, mounts) => {
      expect(mountsComposed(...stated)).toBe(mounts);
    }
  );

  it("no-ssr is no prop's attribute", () => {
    expect(() =>
      Neutron({ tag: uniqueTag(), props: { noSsr: Boolean } })
    ).toThrow(NeutronError);
  });
});
