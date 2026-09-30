import { describe, expect, it } from "@excom/nucleus-test";
import { $, act, back, openApp, press, push, SIZES, TABLE, until, where } from "./app";

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  it("tab highlight and title follow every route", async () => {
    await openApp("/", { size, setup: [["POST", "/bag", { sku: TABLE.sku }], ["POST", "/orders"]] });
    const routes = [
      ["/", "Home · Wrenfield", "home"],
      ["/shop", "All pieces · Wrenfield", "shop"],
      ["/shop/tables", "Tables · Wrenfield", "shop"],
      [TABLE.path, `${TABLE.name} · Wrenfield`, "shop"],
      ["/bag/checkout/details", "Your details · Wrenfield", "bag"],
      ["/account/orders/WF-24001", "Order WF-24001 · Wrenfield", "account"],
      ["/nope", "Not found · Wrenfield", null],
    ];
    for (const [url, title, tab] of routes) {
      if (url !== "/") await act(() => push(url!));
      await until(where).toEqual({ url, title, tab });
    }
    await act(back);
    await until(where).toEqual({ url: routes[5][0], title: routes[5][1], tab: routes[5][2] });
  });

  // Keyboard events only: a browser's own scroll on Space is layout, so `prevented` stands in for it.
  it("Enter follows a link; Space presses a button and does not scroll", async () => {
    const { reload } = await openApp("/", { size });
    const focus = (selector: string) => {
      const element = $(selector)!;
      element.focus();
      return document.activeElement === element;
    };
    expect(focus("#home spa-a[role=link][route-href='/shop']")).toBe(true);
    await act(() => press("Enter"));
    await until(() => where().url).toBe("/shop");
    await reload("/account/story");
    expect(focus("#story spa-a[role=button][route-href='/account/delivery-returns']")).toBe(true);
    const pressed = { url: "/account/delivery-returns", keys: [{ key: " ", prevented: true }] };
    const keys = [press("Space")];
    await until(() => ({ url: where().url, keys })).toEqual(pressed);
  });
});
