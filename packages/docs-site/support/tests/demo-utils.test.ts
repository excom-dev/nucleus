import "@excom/quark";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  DEMO_FLAGS,
  DEMO_STORAGE_KEY,
  handFlagsOver,
  renderInTransition,
  seedDemoStorage,
} from "../../public/demo-utils";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  vi.restoreAllMocks();
});

describe("seedDemoStorage", () => {
  it("writes a payload and re-sets key-name on the providers of that key", () => {
    document.body.innerHTML = `
      <provider-storage key-name="${DEMO_STORAGE_KEY}"></provider-storage>
      <provider-storage key-name="other"></provider-storage>`;
    const [demo, other] = document.querySelectorAll("provider-storage");
    const writes: string[] = [];
    Object.defineProperty(demo, "keyName", {
      set: (v: string) => writes.push(v),
      get: () => writes.at(-1) ?? "",
    });
    Object.defineProperty(other, "keyName", {
      set: () => writes.push("other"),
    });
    seedDemoStorage();
    expect(writes).toEqual(["", DEMO_STORAGE_KEY]);
    expect(
      JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)!)
    ).toHaveProperty("seededAt");
  });
});

describe("handFlagsOver", () => {
  it("writes $app-flags on the listening element", () => {
    document.body.innerHTML = "<div><button></button></div>";
    const owner = document.querySelector("div")!;
    owner.addEventListener("click", handFlagsOver);
    document.querySelector("button")!.click();
    expect(owner.quark.getPropertyValue("$app-flags")).toBe(DEMO_FLAGS);
  });
});

describe("renderInTransition", () => {
  const renderEvent = (thunk: () => unknown) =>
    new CustomEvent("include-content-render", {
      cancelable: true,
      detail: thunk,
    });

  it("runs the thunk inside a view transition and cancels the default", () => {
    const start = vi.fn((update: () => unknown) => update());
    Object.assign(document, { startViewTransition: start });
    const thunk = vi.fn();
    const event = renderEvent(thunk);
    renderInTransition(event);
    expect(event.defaultPrevented).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(thunk).toHaveBeenCalledOnce();
  });

  it("leaves the default render alone without the API", () => {
    const thunk = vi.fn();
    const event = renderEvent(thunk);
    renderInTransition(event);
    expect(event.defaultPrevented).toBe(false);
    expect(thunk).not.toHaveBeenCalled();
  });
});
