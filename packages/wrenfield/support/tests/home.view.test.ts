import { describe, expect, it } from "@excom/nucleus-test";
import { $, $$, openApp, SIZES, until } from "./app";

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  // The controller is the test's stand-in: this pins the shell's gate on it, not real control.
  it("home renders 24 cards and the service worker is in control", async () => {
    await openApp("/", { size });
    await until(() => $$("#home data-product").length).toBe(24);
    expect($("service-worker[has-controller] ~ [bind-app][is-active]")).not.toBeNull();
  });
});
