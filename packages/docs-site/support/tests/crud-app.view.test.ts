import "@excom/provider-fetch";
import "@excom/quark-sheet";
import "@excom/super-form";
import { invokeCommand } from "@excom/neutron";
import {
  afterEach,
  describe,
  expect,
  it,
  readFileRelative,
  vi,
  waitForEvent,
} from "@excom/nucleus-test";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";

const html = readFileRelative(import.meta.url, "../../public/views/crud-app/crud-app.html");
const quarkSrc = readFileRelative(import.meta.url, "../../public/views/crud-app/crud-app.quark");

type Entry = { id: number; name: string; surname: string };
type Sent = { method: string; url: string; body: Record<string, unknown> | undefined };

/** The service worker's names API, in memory: same routes, same answers. */
const fakeApi = (entries: Entry[]) => {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), location.href).pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ method, url, body });
    const id = Number(url.match(/^\/api\/names\/(\d+)$/)?.[1]);
    const at = entries.findIndex((entry) => entry.id === id);
    if (method === "POST") {
      entries.push({ id: Math.max(0, ...entries.map((e) => e.id)) + 1, name: body!.name, surname: body!.surname } as Entry);
    } else if (method === "PATCH" && at >= 0) {
      entries[at] = { id, name: body!.name, surname: body!.surname } as Entry;
    } else if (method === "DELETE" && at >= 0) {
      entries.splice(at, 1);
    }
    return new Response(JSON.stringify(method === "GET" ? entries : {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { sent, entries, writes: () => sent.filter(({ method }) => method !== "GET") };
};

const SEED_ENTRIES: Entry[] = [
  { id: 1, name: "Hans", surname: "Emil" },
  { id: 2, name: "Max", surname: "Mustermann" },
  { id: 3, name: "Roman", surname: "Tisch" },
];
const SEED = ["Emil, Hans", "Mustermann, Max", "Tisch, Roman"];

/** Mount the view over a fresh API; the helpers read and drive it the way a person would. */
const mountCrud = async (entries: Entry[] = SEED_ENTRIES.map((entry) => ({ ...entry }))) => {
  const api = fakeApi(entries);
  const { root, quark } = await mountView(html, quarkSrc);
  const provider = root.querySelector<HTMLElement>("provider-fetch")!;
  if (!provider.hasAttribute("is-success")) {
    await waitForEvent(provider, "provider-fetch-success");
  }
  await flush();
  await flush();

  const field = (name: string) => root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`button[name="${name}"]`)!;
  const rows = () => [...root.querySelectorAll<HTMLLabelElement>("fieldset label")];
  const radio = (row: HTMLLabelElement) => row.querySelector<HTMLInputElement>("input")!;
  /** One keystroke's worth: the value and its `input` event, nothing else. */
  const type = async (name: string, text: string) => {
    field(name).value = text;
    field(name).dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  };
  return {
    root,
    quark: quark!,
    api,
    field,
    button,
    type,
    /** What L shows: the text of every row that is not hidden. */
    listed: () => rows().filter((row) => !row.hidden).map((row) => row.textContent!.trim()),
    /** The text of every row the sheet has checked. */
    checked: () =>
      rows()
        .filter((row) => radio(row).hasAttribute("checked") && radio(row).checked)
        .map((row) => row.textContent!.trim()),
    /** Pick the entry showing `text`, as a click or an arrow key does. */
    select: async (text: string) => {
      const input = radio(rows().find((row) => row.textContent!.trim() === text)!);
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    },
    /**
     * Press a button: what the browser does with a button that is not
     * disabled and has `command` / `commandfor` (happy-dom has no Command
     * API). Resolves once the list was read again.
     */
    press: async (name: string) => {
      const target = button(name);
      if (target.disabled) throw new Error(`${name} is disabled: a browser fires nothing`);
      const form = root.querySelector<HTMLElement>(`#${target.getAttribute("commandfor")}`)!;
      expect(target.getAttribute("command")).toBe("--submit");
      await waitForEvent(provider, "provider-fetch-success", () =>
        invokeCommand(form, "--submit", target),
      );
      await flush();
      await flush();
    },
  };
};

describe("crud-app view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("has Tprefix, Tname, Tsurname, the listbox L, BC / BU / BD and the three labels", async () => {
    const { root, field, button } = await mountCrud();
    const labelOf = (name: string) => field(name).closest("label")!.textContent!.trim();

    expect(labelOf("data-prefix")).toBe("Filter prefix:");
    expect(labelOf("name")).toBe("Name:");
    expect(labelOf("surname")).toBe("Surname:");
    expect(root.querySelector("fieldset")!.getAttribute("aria-label")).toBe("Names");
    expect(["create", "update", "delete"].map((name) => button(name).textContent)).toEqual([
      "Create",
      "Update",
      "Delete",
    ]);
  });

  it("L presents the list the API answers, and the sheet holds no copy", async () => {
    const { root, api, listed, checked } = await mountCrud();

    expect(api.sent).toEqual([{ method: "GET", url: "/api/names", body: undefined }]);
    expect(listed()).toEqual(SEED);
    expect(checked()).toEqual([]);
    expect(root.hasAttribute("data-names")).toBe(false);
  });

  it("selects at most one entry in L at a time", async () => {
    const { root, select, checked } = await mountCrud();

    await select("Emil, Hans");
    expect(checked()).toEqual(["Emil, Hans"]);
    expect(root.getAttribute("data-selected")).toBe("1");

    await select("Tisch, Roman");
    expect(checked()).toEqual(["Tisch, Roman"]);
    expect(root.getAttribute("data-selected")).toBe("3");
  });

  it("filters the names whose surname starts with the prefix, immediately, without enter", async () => {
    const { quark, api, type, listed } = await mountCrud();

    const meter = measureComplexity(quark);
    // `input` only: no `change`, no enter, no submit
    await type("data-prefix", "M");
    const budget = meter.take();
    meter.stop();
    expect(listed()).toEqual(["Mustermann, Max"]);

    // the surname, not the name ("Max"), and whatever the case
    await type("data-prefix", "ti");
    expect(listed()).toEqual(["Tisch, Roman"]);
    await type("data-prefix", "Ha");
    expect(listed()).toEqual([]);

    await type("data-prefix", "");
    expect(listed()).toEqual(SEED);
    // a view only: the API was not asked again
    expect(api.sent).toHaveLength(1);
    expectComplexity(budget);
  });

  it("BC posts the name from Tname and Tsurname, and L shows it appended", async () => {
    const { api, type, press, listed, checked } = await mountCrud();

    await type("name", "John");
    await type("surname", "Romba");
    await press("create");
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "/api/names",
        body: expect.objectContaining({ name: "John", surname: "Romba" }),
      }),
    ]);
    // then the list was read again
    expect(api.sent.map(({ method }) => method)).toEqual(["GET", "POST", "GET"]);
    expect(listed()).toEqual([...SEED, "Romba, John"]);

    // the same name again is a second entry
    await press("create");
    expect(listed()).toEqual([...SEED, "Romba, John", "Romba, John"]);
    expect(checked()).toEqual([]);
  });

  it("BC appends even when the filter hides the new name", async () => {
    const { api, type, press, listed } = await mountCrud();

    await type("data-prefix", "T");
    await type("name", "John");
    await type("surname", "Romba");
    await press("create");
    expect(listed()).toEqual(["Tisch, Roman"]);
    expect(api.entries).toHaveLength(4);

    await type("data-prefix", "");
    expect(listed()).toEqual([...SEED, "Romba, John"]);
  });

  it("enables BU and BD iff an entry in L is selected", async () => {
    const { button, select, type, press, checked } = await mountCrud();
    const enabled = () => ["create", "update", "delete"].map((name) => !button(name).disabled);

    expect(enabled()).toEqual([true, false, false]);

    await select("Mustermann, Max");
    expect(enabled()).toEqual([true, true, true]);

    // filtered out of L: no entry in L is selected
    await type("data-prefix", "T");
    expect(checked()).toEqual([]);
    expect(enabled()).toEqual([true, false, false]);

    // back in L, still the selected entry
    await type("data-prefix", "");
    expect(checked()).toEqual(["Mustermann, Max"]);
    expect(enabled()).toEqual([true, true, true]);

    await press("delete");
    expect(enabled()).toEqual([true, false, false]);
  });

  it("BU patches the selected entry's resource with the fields instead of appending", async () => {
    const { root, api, field, select, type, press, listed, checked } = await mountCrud();

    await select("Mustermann, Max");
    // selecting an entry puts it in the fields
    expect(field("name").value).toBe("Max");
    expect(field("surname").value).toBe("Mustermann");

    // keyed by id: the row stays the same element, so a focused row keeps focus
    const row = root.querySelector("fieldset label:nth-of-type(2)");
    await type("name", "Erika");
    await press("update");
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        url: "/api/names/2",
        body: expect.objectContaining({ name: "Erika", surname: "Mustermann" }),
      }),
    ]);
    expect(api.sent.at(-1)).toMatchObject({ method: "GET", url: "/api/names" });
    expect(root.querySelector("fieldset label:nth-of-type(2)")).toBe(row);
    expect(listed()).toEqual(["Emil, Hans", "Mustermann, Erika", "Tisch, Roman"]);
    expect(checked()).toEqual(["Mustermann, Erika"]);
  });

  it("BD deletes the selected entry's resource and clears the selection", async () => {
    const { root, api, select, press, listed, checked } = await mountCrud();

    await select("Emil, Hans");
    await press("delete");
    expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", url: "/api/names/1" })]);
    expect(api.sent.at(-1)).toMatchObject({ method: "GET", url: "/api/names" });
    expect(listed()).toEqual(["Mustermann, Max", "Tisch, Roman"]);
    expect(root.hasAttribute("data-selected")).toBe(false);
    expect(checked()).toEqual([]);
  });

  it("never acts on a selected entry the filter hides", async () => {
    const { root, api, button, select, type, press, listed } = await mountCrud();

    await select("Mustermann, Max");
    await type("data-prefix", "T");
    expect(listed()).toEqual(["Tisch, Roman"]);

    // BU and BD are disabled and have no entry to address
    expect(button("update").disabled).toBe(true);
    expect(button("delete").disabled).toBe(true);
    expect(root.querySelector("#crud-update")!.hasAttribute("api-url")).toBe(false);
    expect(root.querySelector("#crud-delete")!.hasAttribute("api-url")).toBe(false);
    await expect(press("update")).rejects.toThrow("disabled");
    await expect(press("delete")).rejects.toThrow("disabled");
    expect(api.writes()).toEqual([]);

    // the visible entry is the one a press reaches, not the hidden one
    await select("Tisch, Roman");
    await press("delete");
    expect(api.writes()).toEqual([expect.objectContaining({ method: "DELETE", url: "/api/names/3" })]);
  });

  it("answers an empty API with an empty L, and Create still works", async () => {
    const { api, type, press, listed } = await mountCrud([]);

    expect(listed()).toEqual([]);
    await type("name", "John");
    await type("surname", "Romba");
    await press("create");
    expect(api.entries).toEqual([{ id: 1, name: "John", surname: "Romba" }]);
    expect(listed()).toEqual(["Romba, John"]);
  });
});
