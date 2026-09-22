/**
 * View test for the Element pane: the real HTML + Quark sheet + Adapter,
 * driven by a fake extension adapter. Asserts the behaviors of the pane it
 * replaced (selection labels, empty messages, effect rows + depth indent)
 * plus the new Orchestration tab and "Current" blocks.
 */
import "../../lib/quark-modules";
import "@excom/nucleus-kit";
import {
  defineDevtoolsSelection,
  DID_COPY_MS,
  setClipboardWriter,
  setDevtoolsAdapterFactory,
} from "../../lib/devtools-selection";
import type { LifecycleRecord } from "../../lib/protocol";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeAdapter, infoFor, recordFor } from "./fake-adapter";

defineDevtoolsSelection();

const pageHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../entrypoints/element/index.html"),
  "utf8",
);
const bodyHtml = pageHtml
  .slice(pageHtml.indexOf("<body>") + "<body>".length, pageHtml.indexOf("</body>"))
  .replace(/<script[\s\S]*?<\/script>/g, "");

/** Quark settles across observer + double setTimeout(0) runs + paint. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await wait(0);
};

const mountPane = async (fake: ReturnType<typeof createFakeAdapter>) => {
  setDevtoolsAdapterFactory(() => fake.adapter);
  const host = document.createElement("div");
  host.innerHTML = bodyHtml;
  document.body.append(host);
  const pane = host.querySelector("#element-pane") as HTMLElement;
  await settle();
  return pane;
};

const q = <T extends Element = HTMLElement>(root: ParentNode, selector: string) =>
  root.querySelector(selector) as T;

const rows = (root: ParentNode, log: string) =>
  [...root.querySelectorAll(`[${log}] > li`)] as HTMLElement[];

const effect = (
  seq: number,
  signature: string,
  effectObj: Record<string, unknown>,
  lockDepth = 1,
): LifecycleRecord =>
  recordFor(seq, "7", ["neutron", "effect"], { signature, effect: effectObj, lockDepth });

const apply = (
  seq: number,
  selector: string,
  key: string,
  expression: string,
  result: unknown,
  extra: Record<string, unknown> = {},
): LifecycleRecord =>
  recordFor(seq, "7", ["quark", "apply"], {
    selector,
    key,
    expression,
    result,
    sheetId: 1,
    ruleId: 1,
    runId: "run-1",
    isNoop: false,
    isWipe: false,
    ...extra,
  });

describe("Element pane view", () => {
  let fake: ReturnType<typeof createFakeAdapter>;

  beforeEach(() => {
    fake = createFakeAdapter();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("boots into the empty state with both tabs and both empty messages", async () => {
    fake.setInfo(infoFor(null, null));
    const pane = await mountPane(fake);

    const label = q(pane, "[bind-selection]");
    expect(label.textContent).toBe("Select an element");
    expect(label.hasAttribute("data-empty")).toBe(true);

    const headers = [...pane.querySelectorAll("content-tabs-header")];
    expect(headers.map((h) => h.textContent?.trim())).toEqual(["Neutron", "Quark"]);
    expect(headers[0].hasAttribute("is-open")).toBe(true);
    expect(headers[1].hasAttribute("is-open")).toBe(false);
    expect(
      [...pane.querySelectorAll("[data-role='history']")].map((h) => h.textContent),
    ).toEqual(["History", "History"]);

    expect(q(pane, "[bind-neutron-empty]").hidden).toBe(false);
    expect(q(pane, "[bind-quark-empty]").hidden).toBe(false);
    expect(q(pane, "[bind-neutron-current]").hidden).toBe(true);
    expect(q(pane, "[bind-quark-current]").hidden).toBe(true);
    expect(rows(pane, "bind-neutron-log")).toHaveLength(0);
    expect(rows(pane, "bind-quark-log")).toHaveLength(0);
  });

  it("offers a Copy for AI button that asks the Adapter for the dump and relabels while copied", async () => {
    fake.setInfo(infoFor("x-el", "7"));
    const written: string[] = [];
    setClipboardWriter(async (text) => {
      written.push(text);
    });
    try {
      const pane = await mountPane(fake);
      const button = q<HTMLButtonElement>(pane, "[bind-copy]");
      expect(button.textContent).toBe("Copy for AI");
      expect(button.disabled).toBe(false);
      expect(q(pane, "event-handler").getAttribute("fire-event")).toBe("devtools-selection-dump");

      fake.setInfo('{"tool":"nucleus-devtools"}' as never);
      button.click();
      await settle();
      expect(written).toEqual(['{"tool":"nucleus-devtools"}']);
      const adapter = q(pane, "devtools-selection");
      expect(adapter.hasAttribute("did-copy")).toBe(true);
      expect(button.textContent).toBe("Copied");
      await wait(DID_COPY_MS + 50);
      await settle();
      expect(button.textContent).toBe("Copy for AI");
    } finally {
      setClipboardWriter((text) => navigator.clipboard.writeText(text));
    }
  });

  it("disables Copy for AI while the page API is unavailable", async () => {
    fake.setInfo(null);
    const pane = await mountPane(fake);
    expect(q<HTMLButtonElement>(pane, "[bind-copy]").disabled).toBe(true);
  });

  it("shows the unavailable label when the page API is missing", async () => {
    fake.setInfo(null);
    const pane = await mountPane(fake);
    const label = q(pane, "[bind-selection]");
    expect(label.textContent).toBe("Page API unavailable — reload the tab");
    expect(label.hasAttribute("data-empty")).toBe(true);
  });

  it("labels a selected element that never published", async () => {
    fake.setInfo(infoFor("plain-el", null));
    const pane = await mountPane(fake);
    const label = q(pane, "[bind-selection]");
    expect(label.textContent).toBe("<plain-el> — no publications yet");
    expect(label.hasAttribute("data-empty")).toBe(false);
    expect(q(pane, "[bind-neutron-empty]").hidden).toBe(false);
  });

  it("renders Neutron effect rows with signature, time, tree body and depth indent", async () => {
    fake.setInfo(
      infoFor("x-el", "7", [
        effect(1, 'onPropSet("label")', { textContent: "hi", "aria-label": "x" }),
        effect(2, "", { count: 2 }, 2),
        recordFor(3, "7", ["neutron", "constructed"], {}),
      ]),
    );
    const pane = await mountPane(fake);

    expect(q(pane, "[bind-selection]").textContent).toBe("<x-el>");
    expect(q(pane, "[bind-neutron-empty]").hidden).toBe(true);

    const items = rows(pane, "bind-neutron-log");
    expect(items).toHaveLength(2);

    const first = items[0];
    expect(first.dataset.depth).toBe("0");
    expect(first.style.getPropertyValue("--row-depth")).toBe("0");
    expect(first.hasAttribute("data-status")).toBe(false);
    const details = q<HTMLDetailsElement>(first, 'details[data-role="lifecycle"]');
    expect(details.open).toBe(true);
    const sig = q(first, "[bind-signature]");
    expect(sig.textContent).toBe('onPropSet("label")');
    expect(sig.title).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(first.querySelector("[bind-expression]")).toBeNull();
    const tree = q(first, '[bind-effect] [data-role="tree-root"]');
    expect(tree.dataset.kind).toBe("object");
    expect(
      [...tree.querySelectorAll("[data-role='key']")].map((k) => [k.textContent, (k as HTMLElement).title]),
    ).toEqual([
      ["textContent", ""],
      ["aria-label", ""],
    ]);
    expect(q(tree, '[data-kind="string"]').textContent).toBe('"hi"');

    const second = items[1];
    expect(q(second, "[bind-signature]").textContent).toBe("(anonymous effector)");
    expect(second.dataset.depth).toBe("1");
    expect(second.style.getPropertyValue("--row-depth")).toBe("1");
  });

  it("appends live records for the selected element without a page round-trip", async () => {
    fake.setInfo(infoFor("x-el", "7", [effect(1, "a", { a: 1 })]));
    const pane = await mountPane(fake);
    expect(rows(pane, "bind-neutron-log")).toHaveLength(1);

    fake.deliverRuntime(effect(2, "b", { b: 2 }));
    await settle();
    const items = rows(pane, "bind-neutron-log");
    expect(items).toHaveLength(2);
    expect(q(items[1], "[bind-signature]").textContent).toBe("b");

    // duplicate delivery over the port is ignored
    fake.deliverPort(effect(2, "b", { b: 2 }));
    await settle();
    expect(rows(pane, "bind-neutron-log")).toHaveLength(2);
  });

  it("keeps existing rows (and their open state) when new records arrive", async () => {
    fake.setInfo(infoFor("x-el", "7", [effect(1, "a", { a: 1 })]));
    const pane = await mountPane(fake);
    const firstRow = rows(pane, "bind-neutron-log")[0];
    const details = q<HTMLDetailsElement>(firstRow, 'details[data-role="lifecycle"]');
    details.open = false;

    fake.deliverRuntime(effect(2, "b", { b: 2 }));
    await settle();
    const items = rows(pane, "bind-neutron-log");
    expect(items[0]).toBe(firstRow);
    expect(details.open).toBe(false);
  });

  it("renders Quark rows grouped per rule run, with declarations as key titles and status", async () => {
    fake.setInfo(
      infoFor("x-el", "7", [
        apply(1, "article p[bind-x]", "content", "$greeting", "hi"),
        apply(2, "article p[bind-x]", "data-kind", '"greeting"', "greeting"),
        apply(3, "article", "data-a", "preserve", undefined, { ruleId: 2, runId: "run-2", isNoop: true }),
        apply(4, "article", "data-b", "none", null, { ruleId: 3, runId: "run-2", isWipe: true }),
        recordFor(5, "7", ["quark", "error"], {
          selector: "article",
          key: "title",
          expression: '"x".splice(0)',
          errorMessage: "Method \"splice\" is not allowed",
          errorName: "Error",
        }),
        recordFor(6, "7", ["quark", "sheet", "registered"], { sheetId: 1 }),
      ]),
    );
    const pane = await mountPane(fake);

    expect(q(pane, "[bind-quark-empty]").hidden).toBe(true);
    const items = rows(pane, "bind-quark-log");
    expect(items).toHaveLength(4);
    expect(pane.querySelector("[bind-expression]")).toBeNull();

    // one row for the two declarations of the same rule run
    expect(q(items[0], "[bind-signature]").textContent).toBe("article p[bind-x]");
    expect(items[0].dataset.depth).toBe("0");
    expect(items[0].hasAttribute("data-status")).toBe(false);
    const keys = [...items[0].querySelectorAll("[bind-effect] [data-role='key']")] as HTMLElement[];
    expect(keys.map((k) => [k.textContent, k.title])).toEqual([
      ["content", "content: $greeting"],
      ["data-kind", 'data-kind: "greeting"'],
    ]);
    expect(q(items[0], '[bind-effect] [data-kind="string"]').textContent).toBe('"hi"');

    expect(items[1].dataset.status).toBe("no-op");
    expect(q(items[1], '[bind-effect] [data-kind="string"]').textContent).toBe('"(no-op)"');
    expect(items[2].dataset.status).toBe("wipe");
    expect(q(items[2], '[bind-effect] [data-kind="null"]').textContent).toBe("null");
    expect(items[3].dataset.status).toBe("error");
    expect(q(items[3], "[bind-effect] [data-role='key']").title).toBe('title: "x".splice(0)');
    expect(q(items[3], "[bind-effect] details > summary").textContent).toBe(
      'title{ error: "Error", message: "Method \\"splice\\" is n…" }',
    );
  });

  it("switches tabs by clicking headers", async () => {
    fake.setInfo(infoFor(null, null));
    const pane = await mountPane(fake);
    const headers = [...pane.querySelectorAll("content-tabs-header")];
    const bodies = [...pane.querySelectorAll("content-tabs-body")];

    headers[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(0);
    expect(headers[1].hasAttribute("is-open")).toBe(true);
    expect(headers[0].hasAttribute("is-open")).toBe(false);
    expect(bodies[1].hasAttribute("is-open")).toBe(true);
    expect(bodies[0].hasAttribute("is-open")).toBe(false);

    headers[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(0);
    expect(bodies[0].hasAttribute("is-open")).toBe(true);
    expect(bodies[1].hasAttribute("is-open")).toBe(false);
  });

  it("shows current props and current variables from the inspect snapshots", async () => {
    fake.setInfo(
      infoFor("x-el", "7", [], {
        neutron: { tag: "x-el", props: { label: "hi", count: 2 } },
        quark: {
          vars: { $count: 3, $box: "open" },
          attributes: { "data-count": "3" },
          styleProperties: { "--tone": "warm" },
          listeners: { click: [{ $constructor: "Function", $expression: "handler($sig)" }] },
          loop: null,
        },
      }),
    );
    const pane = await mountPane(fake);

    const neutronCurrent = q<HTMLDetailsElement>(pane, "[bind-neutron-current]");
    expect(neutronCurrent.hidden).toBe(false);
    expect(neutronCurrent.tagName).toBe("DETAILS");
    expect(neutronCurrent.open).toBe(true);
    expect(q(neutronCurrent, ":scope > summary").textContent).toBe("Current properties");
    expect(
      [...neutronCurrent.querySelectorAll("[bind-tree] > [data-role='tree-root'] > [data-role='entries'] > [data-role='entry'] > [data-role='key']")].map(
        (k) => k.textContent,
      ),
    ).toEqual(["label", "count"]);

    const quarkCurrent = q<HTMLDetailsElement>(pane, "[bind-quark-current]");
    expect(quarkCurrent.hidden).toBe(false);
    expect(q(quarkCurrent, ":scope > summary").textContent).toBe("Current properties");
    const sections = [
      ...quarkCurrent.querySelectorAll(
        "[bind-tree] > [data-role='tree-root'] > [data-role='entries'] > details[data-role='entry']",
      ),
    ];
    expect(sections.map((d) => q(d, "[data-role='key']").textContent)).toEqual([
      "variables",
      "attributes",
      "style properties",
      "listeners",
    ]);
    expect(q(sections[0], "[data-role='preview']").textContent).toBe(
      '{ $count: 3, $box: "open" }',
    );
    // listeners list the attached functions, hover shows the declaration
    const fn = q(sections[3], "[data-kind='constructor']");
    expect(fn.textContent).toBe("Function");
    expect(fn.title).toBe("handler($sig)");
  });

  it("hides the current blocks and re-labels when the selection changes", async () => {
    fake.setInfo(
      infoFor("x-el", "7", [effect(1, "a", { a: 1 })], {
        neutron: { props: { a: 1 } },
        quark: null,
      }),
    );
    const pane = await mountPane(fake);
    expect(q(pane, "[bind-neutron-current]").hidden).toBe(false);
    expect(rows(pane, "bind-neutron-log")).toHaveLength(1);

    fake.selectElement(infoFor("plain-el", null));
    await settle();
    expect(q(pane, "[bind-selection]").textContent).toBe("<plain-el> — no publications yet");
    expect(q(pane, "[bind-neutron-current]").hidden).toBe(true);
    expect(rows(pane, "bind-neutron-log")).toHaveLength(0);
    expect(q(pane, "[bind-neutron-empty]").hidden).toBe(false);
  });

  it("stops its extension listeners when removed from the document", async () => {
    fake.setInfo(infoFor(null, null));
    const pane = await mountPane(fake);
    expect(fake.runtimeListenerCount()).toBe(1);
    pane.remove();
    await wait(0);
    expect(fake.runtimeListenerCount()).toBe(0);
    expect(fake.selectionListenerCount()).toBe(0);
  });
});
