import "@excom/quark-sheet";
import { Quark } from "@excom/quark";
import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { installViewTransitionStub } from "@excom/quark/support/tests/helpers";
import {
  bypassSelectorCache,
  click,
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(import.meta.url, "../../public/views/view-transitions-app/view-transitions-app.html");
const quarkSrc = readViewFile(import.meta.url, "../../public/views/view-transitions-app/view-transitions-app.quark");

/** Past the first render, whose paints never transition. */
const settle = async () => {
  await flush();
  await Quark.whenSettled();
};

const planets = (root: Element) => [...root.querySelectorAll(".planets > li")];
const current = (root: Element) =>
  root.querySelector(".pages > article[is-current]")?.getAttribute("data-page-index");

describe("view-transitions-app view", () => {
  let restoreCache: () => void;
  beforeAll(() => {
    restoreCache = bypassSelectorCache();
  });
  afterAll(() => restoreCache());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the initial state and stays within the complexity budget on a card click", async () => {
    const { root, quark } = await mountView(html, quarkSrc);
    await settle();
    expect(root.querySelector(".cards > li[is-open]")).toBeNull();
    expect(current(root)).toBe("1");
    expect(root.querySelector<HTMLButtonElement>("[data-move='back']")!.disabled).toBe(true);
    expect(root.querySelector("[bind-page]")!.textContent).toBe("1 / 3");
    expect(planets(root).map((li) => li.textContent)).toEqual(["Mercury", "Venus", "Earth"]);
    expect(planets(root)[0].style.getPropertyValue("--vt-name")).toBe("planet-mercury");
    expect(root.querySelector<HTMLElement>(".cards > li")!.style.getPropertyValue("--vt-name")).toBe("card-alpha");
    expect(root.querySelector("[bind-tip]")!.textContent).toMatch(/^Declare/);

    const meter = measureComplexity(quark!);
    click(root.querySelector("[data-card-id='beta']"));
    await settle();
    const budget = meter.take();
    meter.stop();
    expect([...root.querySelectorAll(".cards > li")].map((li) => li.hasAttribute("is-open"))).toEqual([false, true, false, false]);
    expect(root.getAttribute("data-open-card")).toBe("beta");
    expectComplexity(budget);
  });

  it("runs one typed view transition per cut: card, slide, list, tip", async () => {
    const stub = installViewTransitionStub();
    try {
      const { root } = await mountView(html, quarkSrc);
      await settle();
      expect(stub.calls).toHaveLength(0);
      const typesOf = (i: number) => [...stub.calls[i].types].sort();

      click(root.querySelector("[data-card-id='alpha']"));
      await settle();
      await stub.calls[0].finished;
      expect(typesOf(0)).toEqual(["card-open"]);
      click(root.querySelector("[data-card-id='alpha']"));
      await settle();
      await stub.calls[1].finished;
      expect(typesOf(1)).toEqual(["card-close"]);
      expect(root.hasAttribute("data-open-card")).toBe(false);

      click(root.querySelector("[data-move='forward']"));
      await settle();
      await stub.calls[2].finished;
      expect(typesOf(2)).toEqual(["slide-forward"]);
      expect(current(root)).toBe("2");
      click(root.querySelector("[data-move='back']"));
      await settle();
      await stub.calls[3].finished;
      expect(typesOf(3)).toEqual(["slide-back"]);
      expect(current(root)).toBe("1");

      const mercury = planets(root)[0];
      click(root.querySelector("[data-list='add']"));
      await settle();
      await stub.calls[4].finished;
      expect(typesOf(4)).toEqual(["list"]);
      expect(planets(root).map((li) => li.textContent)).toEqual(["Mercury", "Venus", "Earth", "Mars"]);
      click(root.querySelector("[data-list='reverse']"));
      await settle();
      await stub.calls[5].finished;
      // reordered, not re-rendered: the same node moved to the end
      expect(planets(root).map((li) => li.textContent)).toEqual(["Mars", "Earth", "Venus", "Mercury"]);
      expect(planets(root)[3]).toBe(mercury);
      click(root.querySelector("[data-list='remove']"));
      await settle();
      await stub.calls[6].finished;
      expect(planets(root).map((li) => li.textContent)).toEqual(["Earth", "Venus", "Mercury"]);

      const before = root.querySelector("[bind-tip]")!.textContent;
      click(root.querySelector("[data-next-tip]"));
      await settle();
      await stub.calls[7].finished;
      expect(typesOf(7)).toEqual(["tip"]);
      expect(root.querySelector("[bind-tip]")!.textContent).not.toBe(before);
      expect(stub.calls).toHaveLength(8);
      expect(stub.calls.every((call) => call.isUpdated)).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it("round-trips every fact: reopen after close, swap cards, reverse back, page both ways", async () => {
    const { root } = await mountView(html, quarkSrc);
    await settle();
    const openCard = () => root.querySelector(".cards > li[is-open]")?.getAttribute("data-card-id");

    // a card reopens after being closed, and one click swaps which is open
    click(root.querySelector("[data-card-id='beta']"));
    await settle();
    expect(openCard()).toBe("beta");
    click(root.querySelector("[data-card-id='beta']"));
    await settle();
    expect(openCard()).toBeUndefined();
    click(root.querySelector("[data-card-id='beta']"));
    await settle();
    expect(openCard()).toBe("beta");
    click(root.querySelector("[data-card-id='delta']"));
    await settle();
    expect(openCard()).toBe("delta");
    expect(root.querySelectorAll(".cards > li[is-open]")).toHaveLength(1);

    // reverse toggles back to ascending
    click(root.querySelector("[data-list='reverse']"));
    await settle();
    expect(planets(root).map((li) => li.textContent)).toEqual(["Earth", "Venus", "Mercury"]);
    click(root.querySelector("[data-list='reverse']"));
    await settle();
    expect(planets(root).map((li) => li.textContent)).toEqual(["Mercury", "Venus", "Earth"]);
    expect(root.hasAttribute("data-is-reversed")).toBe(false);

    // the pager walks up and back down, and the ends stay disabled
    click(root.querySelector("[data-move='forward']"));
    await settle();
    click(root.querySelector("[data-move='forward']"));
    await settle();
    expect(current(root)).toBe("3");
    expect(root.querySelector<HTMLButtonElement>("[data-move='forward']")!.disabled).toBe(true);
    click(root.querySelector("[data-move='back']"));
    await settle();
    expect(current(root)).toBe("2");
    expect(root.getAttribute("data-last-move")).toBe("back");
    expect(root.querySelector<HTMLButtonElement>("[data-move='forward']")!.disabled).toBe(false);
  });
});
