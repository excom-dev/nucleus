import { describe, expect, it } from "@excom/nucleus-test";
import { $, $$, act, hold, idle, openApp, push, SIZES, TABLE, text, until } from "./app";

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  // No stylesheets on happy-dom: `tradeShown` is the fact shell.css shows trade prices on.
  it("product price and trade price follow the finish", async () => {
    await openApp(TABLE.path, { size, setup: [["PATCH", "/session", { isTrade: true }]] });
    const price = () => ({
      finish: $("#product data-product")!.getAttribute("finish-id"),
      price: text("#product .price [bind-price]"),
      trade: text("#product .price [bind-trade-price]"),
      tradeShown: $("#me")!.hasAttribute("is-trade"),
    });
    await until(price).toEqual({ finish: "stone-oak", price: "$3,600", trade: "$3,060", tradeShown: true });
    await act(() => $$("#product [bind-finishes] input").at(-1)!.click());
    await until(price).toEqual({ finish: "stone-walnut", price: "$3,880", trade: "$3,298", tradeShown: true });
  });

  // The facts product.css swaps the skeleton and the piece on.
  it("shows a skeleton in place of the piece until it loads", async () => {
    await openApp("/saved", { size });
    const release = hold(/^GET \/api\/products\/thorpe-coffee-table$/);
    push(TABLE.path);
    const page = () => ({
      skeleton: !!$("#product provider-fetch > .wf-skeleton:not([hidden])[aria-hidden='true'] > .stage"),
      piece: !!$("#product provider-fetch > .wf-skeleton[hidden] ~ data-product"),
      notFound: !!$("#product provider-fetch[is-error]"),
    });
    await until(page).toEqual({ skeleton: true, piece: false, notFound: false });
    await idle();
    expect(page()).toEqual({ skeleton: true, piece: false, notFound: false });
    release();
    await idle();
    expect(page()).toEqual({ skeleton: false, piece: true, notFound: false });
    expect(text("#product h1")).toBe(TABLE.name);
  });

  // Every drag on the model turns it; none scrolls the page.
  it("gives the 3D model every touch", async () => {
    await openApp(TABLE.path, { size });
    expect($("#product model-viewer")!.getAttribute("touch-action")).toBe("none");
  });
});
