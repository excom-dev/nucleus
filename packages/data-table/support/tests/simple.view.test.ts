import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
  wait,
} from "@excom/nucleus-test";
import { click, flush, mountView } from "@excom/quark/support/tests/view-helpers";

const rowOrder = (tr: HTMLElement) =>
  parseInt(tr.style.getPropertyValue("--data-tr-order") || "0", 10);

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders rows and sorts by name", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    await wait(0);
    const rows = () =>
      [...root.querySelectorAll("data-tbody data-tr")] as HTMLElement[];
    const byOrder = () => [...rows()].sort((a, b) => rowOrder(a) - rowOrder(b));
    expect(byOrder()[0].querySelector("data-td")?.textContent).toBe("Adam");
    click(root.querySelector("data-th"));
    await flush();
    await wait(0);
    expect(byOrder()[0].querySelector("data-td")?.textContent).toBe("Cynthia");
  });
});
