import { describe, it } from "@excom/nucleus-test";
import { $, $$, act, fill, openApp, SIZES, text, until, where } from "./app";

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

  it.skip("back to a scrolled shop list restores its offset", () => {
    // Needs layout and scroll positions: happy-dom has neither. Chrome only.
  });
});
