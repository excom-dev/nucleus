import { vi } from "vitest";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

/*
 * `mutate-target` guards a form that yields no data. `formToJson` always
 * returns an object for a real form, so stub the helper to reach the guard.
 */
vi.mock("@excom/kit-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@excom/kit-utils")>();
  return {
    ...actual,
    formToJson: vi.fn(() => null),
  };
});

import "../../index";

describe("event-handler mutate-target with an empty form result", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("still writes attr-* attributes when the form yields nothing", () => {
    fixture<HTMLDivElement>(
      `<div id="mutate-empty-form"></div>
       <event-handler
         mutate-target
         target-ref="#mutate-empty-form"
         listen-for="my-event"
         form-ref="form"
         attr-data-state="open">
           <form><input name="data-ignored" value="x" type="text"></form>
       </event-handler>`,
    );
    const eventHandler = document.querySelector("event-handler")!;
    eventHandler.dispatchEvent(new CustomEvent("my-event"));
    const div = document.querySelector("#mutate-empty-form")!;
    expect(div.getAttribute("data-state")).toBe("open");
    expect(div.hasAttribute("data-ignored")).toBe(false);
  });
});
