import { describe, expect, it } from "@excom/nucleus-test";
import { $, $$, hold, idle, openApp, SIZES, until } from "./app";

/** What a person sees: elements outside any `hidden` subtree. */
const shown = (selector: string) => $$(selector).filter((element) => !element.closest("[hidden]"));

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  // The controller is the test's stand-in: this pins the shell's gate on it, not real control.
  it("home renders 24 cards and the service worker is in control", async () => {
    await openApp("/", { size });
    await until(() => $$("#home data-product").length).toBe(24);
    expect($("service-worker[has-controller] ~ [bind-app][is-active]")).not.toBeNull();
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
});
