import { describe, expect, it } from "@excom/nucleus-test";
import { $, $$, act, fill, hold, idle, openApp, push, SIZES, text, until, where } from "./app";

/** What a person sees: elements outside any `hidden` subtree. */
const shown = (selector: string) => $$(selector).filter((element) => !element.closest("[hidden]"));

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  it("header search follows a query-only change and a reload", async () => {
    const { reload } = await openApp("/shop", { size });
    const listing = () => ({
      ...where(),
      input: $<HTMLInputElement>("[bind-search] input")!.value,
      h1: text("#shop h1"),
      cards: $$("#shop [bind-products] > data-product").length,
    });
    const results = (q: string, cards: number) => {
      const title = `Results for “${q}”`;
      return { url: `/shop?q=${q}`, title: `${title} · Wrenfield`, tab: "shop", input: q, h1: title, cards };
    };
    const search = async (q: string) => {
      fill({ "[bind-search] input": q });
      await until(() => $("[bind-search]")!.getAttribute("route-href")).toBe(`/shop?q=${q}`);
      await act(() => $<HTMLFormElement>("[bind-search] form")!.requestSubmit());
    };
    await search("oak");
    await until(listing).toEqual(results("oak", 9));
    await search("walnut");
    await until(listing).toEqual(results("walnut", 7));
    await reload("/shop?q=walnut");
    await until(listing).toEqual(results("walnut", 7));
  });

  it("skeleton cards stand in for the listing until it loads", async () => {
    const release = hold(/^GET \/api\/products/);
    const { worker } = await openApp("/shop", { size });
    const { total } = (await worker.api("GET", "/products")).body as { total: number };

    expect(shown("#shop .wf-skeleton")).toHaveLength(6);
    expect(shown("#shop .wf-skeleton").every((card) => card.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(shown("#shop [bind-products] > data-product")).toHaveLength(0);
    expect(shown("#shop [bind-empty]")).toHaveLength(0);

    release();
    await idle();
    expect(shown("#shop .wf-skeleton")).toHaveLength(0);
    expect(shown("#shop [bind-products] > data-product")).toHaveLength(total);
    expect(shown("#shop [bind-empty]")).toHaveLength(0);
  });

  it("Nothing matches shows only once the loaded listing is empty", async () => {
    const release = hold(/^GET \/api\/products/);
    await openApp("/shop?q=zzzz", { size });
    expect(shown("#shop .wf-skeleton")).toHaveLength(6);
    expect(shown("#shop [bind-empty]")).toHaveLength(0);

    release();
    await idle();
    expect(shown("#shop .wf-skeleton")).toHaveLength(0);
    expect(shown("#shop [bind-products] > data-product")).toHaveLength(0);
    expect(text("#shop [bind-empty] h2")).toBe("Nothing matches");
    expect(shown("#shop [bind-empty]")).toHaveLength(1);
  });

  it("a refetch keeps the listing on screen and does not bring the skeleton back", async () => {
    await openApp("/shop?q=oak", { size });
    const cards = () => shown("#shop [bind-products] > data-product").length;
    const release = hold(/^GET \/api\/products\?.*q=walnut/);
    push("/shop?q=walnut");
    await until(() => $("#shop provider-fetch")!.hasAttribute("is-loading")).toBe(true);

    expect(shown("#shop .wf-skeleton")).toHaveLength(0);
    expect(cards()).toBe(9);

    release();
    await idle();
    expect(shown("#shop .wf-skeleton")).toHaveLength(0);
    expect(cards()).toBe(7);
  });

  it.skip("back to a scrolled shop list restores its offset", () => {
    // Needs layout and scroll positions: happy-dom has neither. Chrome only.
  });
});
