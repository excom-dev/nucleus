/** The server entry's `settle` hook: a prerendered page waits for its sheets, however long they take. */
import "../../index";
import { settle } from "../../server";
import { afterEach, describe, expect, fixture, it, wait } from "@excom/nucleus-test";
import { Quark } from "@excom/quark";

const loader = Quark.moduleLoader;

describe("quark-sheet server entry", () => {
  afterEach(() => {
    Quark.moduleLoader = loader;
    document.body.innerHTML = "";
  });

  it("settle waits for a sheet past the 1 s Quark.whenSettled() gives up after", async () => {
    let release!: (module: Record<string, unknown>) => void;
    Quark.moduleLoader = () => new Promise((resolve) => (release = resolve));
    const main = fixture<HTMLElement>(
      `<main><p id="out"></p><quark-sheet>@use "/slow.js" as *; #out { content: greet(); }</quark-sheet></main>`,
    );
    let settled = false;
    const hook = (async () => {
      await settle();
      settled = true;
    })();
    expect(await Quark.whenSettled()).toBe("timeout");
    await wait(50);
    expect(settled).toBe(false);
    release({ greet: () => "hi" });
    await hook;
    expect(main.querySelector("#out")!.textContent).toBe("hi");
  });

  it("settle resolves at once when no sheet has work", async () => {
    expect(await Promise.race([settle(), wait(500).then(() => "late")])).toBe("settled");
  });
});
