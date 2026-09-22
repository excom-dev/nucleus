import {
  afterEach,
  describe,
  expect,
  it,
  spyFetch,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "@excom/provider-fetch";
import "@excom/provider-storage";
import {
  createSheet,
  expectComplexity,
  flush,
  measureComplexity,
  unregisterAll,
} from "./helpers";

const whenFetchSuccess = (el: Element) =>
  new Promise<void>((resolve) => {
    el.addEventListener("provider-fetch-success", () => resolve(), {
      once: true,
    });
  });

describe("Quark with providers", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("binds provider-fetch body fields via prop()", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({
        id: 1,
        title: "delectus aut autem",
        completed: false,
      }),
    });

    const { root, quark, register } = createSheet(
      `<provider-fetch api-url="/api/todos/1">
        <span bind-title></span>
      </provider-fetch>`,
      `provider-fetch[is-success] {
        $todo: prop("provision").body;
        [bind-title] { content: $todo.title; }
      }`,
    );
    const meter = measureComplexity(quark);
    register();
    const provider = root.querySelector("provider-fetch")!;
    await whenFetchSuccess(provider);
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("[bind-title]")?.textContent).toBe(
      "delectus aut autem",
    );
    expectComplexity(budget);
    quark.unregister();
  });

  it("iterates provider-fetch body into a list", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify([{ label: "one" }, { label: "two" }]),
    });

    const { root, quark, register } = createSheet(
      `<provider-fetch api-url="/api/items">
        <ul>
          <template><li bind-label></li></template>
        </ul>
      </provider-fetch>`,
      `provider-fetch[is-success] {
        $items: prop("provision").body;
        ul { content: iterate($items); }
        [bind-label] { content: item.label; }
      }`,
    );
    const meter = measureComplexity(quark);
    register();
    const provider = root.querySelector("provider-fetch")!;
    await whenFetchSuccess(provider);
    await flush();

    const items = [...root.querySelectorAll("ul > li")];
    expect(items).toHaveLength(2);

    const budget = meter.take();
    meter.stop();

    expect(items.map((el) => el.textContent)).toEqual(["one", "two"]);
    expectComplexity(budget);
    quark.unregister();
  });

  it("updates bindings when provider-fetch re-provisions", async () => {
    let payload = { id: 1, title: "Hello", completed: false };
    spyFetch(() => ({
      status: 200,
      body: JSON.stringify(payload),
    }));

    const { root, quark, register } = createSheet(
      `<provider-fetch api-url="/api/todos/1">
        <span bind-title></span>
      </provider-fetch>`,
      `provider-fetch[is-success] {
        $todo: prop("provision").body;
        [bind-title] { content: $todo.title; }
      }`,
    );
    const meter = measureComplexity(quark);
    register();
    const provider = root.querySelector("provider-fetch")!;
    await whenFetchSuccess(provider);
    await flush();
    expect(root.querySelector("[bind-title]")?.textContent).toBe("Hello");

    payload = { id: 1, title: "Hello, world!", completed: false };
    const nextSuccess = whenFetchSuccess(provider);
    // `--fetch` command (provider-fetch no longer listens for a trigger event)
    provider.dispatchEvent(
      Object.defineProperties(new Event("command", { cancelable: true }), {
        command: { value: "--fetch" },
        source: { value: null },
      }),
    );
    await nextSuccess;
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("[bind-title]")?.textContent).toBe(
      "Hello, world!",
    );
    expectComplexity(budget);
    quark.unregister();
  });

  it("binds provider-storage via prop()", async () => {
    localStorage.setItem("quark-ps-test", JSON.stringify({ msg: "stored" }));

    const { root, quark, register } = createSheet(
      `<provider-storage key-name="quark-ps-test">
        <span bind-msg></span>
      </provider-storage>`,
      `provider-storage[is-success] {
        $val: prop("provision");
        [bind-msg] { content: $val.msg; }
      }`,
    );
    const meter = measureComplexity(quark);
    register();
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("[bind-msg]")?.textContent).toBe("stored");
    expectComplexity(budget);
    quark.unregister();
  });
});
