import "@excom/provider-fetch";
import "@excom/quark-sheet";
import "@excom/super-form";
import {
  afterEach,
  describe,
  expect,
  it,
  spyFetch,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(import.meta.url, "../../public/views/todo-app/todo-app.html");
const quarkSrc = readViewFile(import.meta.url, "../../public/views/todo-app/todo-app.quark");

const todos = [
  { id: 1, title: "Buy milk", completed: false },
  { id: 2, title: "Walk dog", completed: true },
];

/** Mount the view and wait for the todo list to load. */
const mountTodos = async () => {
  spyFetch({ status: 200, body: JSON.stringify(todos) });
  const { root, quark } = await mountView(html, quarkSrc);
  const list = root.querySelector<HTMLElement>("provider-fetch[api-url]")!;
  if (!list.hasAttribute("is-success")) {
    await waitForEvent(list, "provider-fetch-success");
    await flush();
  }
  await flush();
  return { root, quark: quark!, list };
};

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLLIElement>("li")];
const submit = (form: HTMLSuperFormElement) =>
  form.getFormElement()!.dispatchEvent(new Event("submit", { bubbles: true }));

describe("todo-app view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists todos, posts a new one, and stays within the complexity budget", async () => {
    const { root, quark } = await mountTodos();

    const titles = rows(root).map(
      (li) => li.querySelector<HTMLInputElement>('input[name="title"]')!.value,
    );
    expect(titles).toEqual(["Buy milk", "Walk dog"]);
    expect(
      rows(root).map((li) => li.querySelector<HTMLInputElement>('input[name="completed"]')!.checked),
    ).toEqual([false, true]);
    // each row's forms post to the todo's own resource
    expect(
      rows(root).map((li) => li.querySelector("form")!.getAttribute("action")),
    ).toEqual(["/api/todos/1", "/api/todos/2"]);

    const creator = root.querySelector<HTMLSuperFormElement>(
      'super-form:has(form[method="post"])',
    )!;
    const title = creator.querySelector<HTMLInputElement>('input[name="title"]')!;
    title.value = "Write tests";

    const meter = measureComplexity(quark);
    await waitForEvent(creator, "super-form-success", () => submit(creator));
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(creator.hasAttribute("is-success")).toBe(true);
    expectComplexity(budget);
  });

  it("patches a completed flag and deletes a row", async () => {
    const { root } = await mountTodos();
    const [first] = rows(root);

    // toggling the checkbox triggers the row's patch form
    const checkbox = first.querySelector<HTMLInputElement>('input[name="completed"]')!;
    const patcher = checkbox.closest<HTMLSuperFormElement>("super-form")!;
    expect(patcher.getFormElement()!.getAttribute("method")).toBe("patch");
    checkbox.checked = true;
    await waitForEvent(patcher, "super-form-success", () => {
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(patcher.hasAttribute("is-success")).toBe(true);

    // the delete form submits to the same resource
    const deleter = first.querySelector<HTMLSuperFormElement>(
      'super-form:has(form[method="delete"])',
    )!;
    expect(deleter.getFormElement()!.getAttribute("action")).toBe("/api/todos/1");
    await waitForEvent(deleter, "super-form-success", () => submit(deleter));
    await flush();
    expect(deleter.hasAttribute("is-success")).toBe(true);
  });
});
