import { describe, it } from "@excom/nucleus-test";
import { $, act, BAG, click, fill, openApp, SCHEDULE, SIZES, terms, text, TOTALS, until, where } from "./app";

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  it("checkout's four steps place an order with the expected totals", async () => {
    await openApp("/bag/checkout/details", { size, setup: BAG });
    const next = () => click("main spa-route[is-active] spa-route[is-active] button[type=submit]");
    const summary = () => ({ url: where().url, totals: terms("#checkout dl.totals"), schedule: terms("#checkout dl.schedule") });
    const placed = () => ({ url: where().url, id: text("#checkout-complete [bind-order=id]"), schedule: terms("#checkout-complete dl.schedule") });
    await until(() => !!$<HTMLInputElement>("input[name='contact.name']")?.value).toBe(true);
    await act(next);
    await until(() => text("#checkout-delivery input[value=collect] ~ data")).toBe("Free");
    await act(() => click("#checkout-delivery input[value=collect]"));
    await act(next);
    await until(() => where().url).toBe("/bag/checkout/payment");
    await act(next);
    await until(summary).toEqual({ url: "/bag/checkout/review", totals: TOTALS, schedule: SCHEDULE });
    await until(() => text("#checkout-review [bind-bag=deliveryFee]")).toBe("Free");
    await act(next);
    await until(placed).toEqual({ url: "/bag/checkout/complete", id: "WF-24001", schedule: SCHEDULE });
  });

  it("typed details survive a refused step", async () => {
    const { worker } = await openApp("/bag/checkout/details", { size, setup: BAG, allow: [/^PATCH \/api\/checkout -> 422$/] });
    const submit = (values: Record<string, string>) => {
      fill(values);
      click("#checkout-details button[type=submit]");
    };
    const form = () => ({
      url: where().url,
      name: $<HTMLInputElement>("input[name='contact.name']")!.value,
      invalid: $("input[name='contact.email']")!.getAttribute("aria-invalid"),
    });
    const saved = async () => ({ url: where().url, name: (await worker.api("GET", "/checkout")).body.contact.name });
    await until(() => !!$<HTMLInputElement>("input[name='contact.name']")?.value).toBe(true);
    await act(() => submit({ "[name='contact.name']": "Typed Name", "[name='contact.email']": "" }));
    await until(form).toEqual({ url: "/bag/checkout/details", name: "Typed Name", invalid: "true" });
    await act(() => submit({ "[name='contact.email']": "typed@example.com" }));
    await until(saved).toEqual({ url: "/bag/checkout/delivery", name: "Typed Name" });
  });
});
