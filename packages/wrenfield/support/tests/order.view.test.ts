import { describe, it } from "@excom/nucleus-test";
import { $$, act, openApp, ORDER, push, SCHEDULE, SIZES, terms, TOTALS, until } from "./app";

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  it("order page and account list show money", async () => {
    await openApp("/account/orders/WF-24001", { size, setup: ORDER });
    const order = () => ({ totals: terms("#order dl.totals"), schedule: terms("#order dl.schedule") });
    const orders = () =>
      $$("#account [bind-orders] li").map((li) =>
        ["[bind-item=id]", "[bind-order-total]"].map((selector) => li.querySelector(selector)!.textContent),
      );
    await until(order).toEqual({ totals: TOTALS, schedule: SCHEDULE });
    await act(() => push("/account"));
    await until(orders).toEqual([["WF-24001", "$7,400"]]);
  });
});
