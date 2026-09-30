import { describe, it } from "@excom/nucleus-test";
import { $, $$, act, openApp, SIZES, TABLE, text, until } from "./app";

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
});
