import { describe, expect, it } from "@excom/nucleus-test";
import { $$, hold, idle, openApp, SIZES, until } from "./app";

/** What a person sees: elements outside any `hidden` subtree. */
const shown = (selector: string) => $$(selector).filter((element) => !element.closest("[hidden]"));

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  // Control is index.html's script, which waits for it before the kit loads (public.test.ts); here the stand-in answers.
  it("home renders 24 cards and the service worker is in control", async () => {
    await openApp("/", { size });
    await until(() => $$("#home data-product").length).toBe(24);
    expect(document.body.getAttribute("data-layout")).toBe(size === SIZES.phone ? "compact" : "regular");
  });

  it("home shows a hero and 4 cards per rail as skeletons until the showroom loads", async () => {
    const release = hold(/^GET \/api\/home$/);
    await openApp("/", { size });
    const rails = () => shown("#home [bind-skeleton][role='list']").map((rail) => rail.querySelectorAll(".wf-skeleton").length);

    expect(shown("#home [bind-skeleton='hero']")).toHaveLength(1);
    expect(rails()).toEqual([4, 4, 4, 4, 4]);
    expect(shown("#home .wf-skeleton").every((card) => card.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(shown("#home data-product")).toHaveLength(0);

    release();
    await idle();
    expect(shown("#home .wf-skeleton")).toHaveLength(0);
    expect(shown("#home data-product")).toHaveLength(24);
  });

  it.skip("the theme's colours apply", () => {
    // Needs the built stylesheet and a browser's colour resolution: happy-dom has neither. Chrome only.
  });
});
