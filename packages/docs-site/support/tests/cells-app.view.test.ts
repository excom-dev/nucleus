import "@excom/quark-sheet";
import { Quark } from "@excom/quark";
import {
  expectComplexity,
  flush,
  measureComplexity,
} from "@excom/quark/support/tests/helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as cellsApp from "../../public/views/cells-app/cells-app";

const viewDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/views/cells-app",
);
const viewHtml = readFileSync(resolve(viewDir, "cells-app.html"), "utf8");
const viewQuark = readFileSync(resolve(viewDir, "cells-app.quark"), "utf8");
const thHtml = /<thead>[\s\S]*?<template>([\s\S]*?)<\/template>/.exec(
  viewHtml,
)?.[1];
const tdHtml = /<td>[\s\S]*?<\/td>/.exec(viewHtml)?.[0];

const COLS = 26;
const ROWS = 100;
const CELL_COUNT = COLS * ROWS;

const originalLoader = Quark.moduleLoader;

/**
 * happy-dom fosters `<template>` out of `<table>` / `<tr>` when parsing
 * HTML strings. Rebuild the iterate templates via DOM APIs so the real
 * view sheet can run. Markup is taken from the view HTML.
 */
const restoreIterateTemplates = (root: HTMLElement) => {
  if (!thHtml || !tdHtml) {
    throw new Error("could not extract iterate templates from cells-app.html");
  }
  const theadTr = root.querySelector("thead tr");
  if (!theadTr) throw new Error("missing thead tr");
  const thTpl = document.createElement("template");
  thTpl.innerHTML = thHtml;
  theadTr.replaceChildren(thTpl);

  const tbody = root.querySelector("tbody");
  if (!tbody) throw new Error("missing tbody");
  const cellTpl = document.createElement("template");
  cellTpl.innerHTML = tdHtml;
  const tr = document.createElement("tr");
  tr.append(cellTpl);
  const rowTpl = document.createElement("template");
  rowTpl.content.append(tr);
  tbody.replaceChildren(rowTpl);
};

const settleCells = async (root: HTMLElement) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (root.querySelectorAll("tbody input").length >= CELL_COUNT) return;
    await flush();
  }
  throw new Error(
    `cells-app settled with ${root.querySelectorAll("tbody input").length} inputs, expected ${CELL_COUNT}`,
  );
};

const mountCellsApp = async (
  onInstance?: (quark: Quark) => ReturnType<typeof measureComplexity>,
) => {
  const html = viewHtml
    .replace(/<link[\s\S]*?>/, "")
    .replace(/\s+src-url="[^"]*"/, "");
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const root = wrap.firstElementChild as HTMLElement;
  restoreIterateTemplates(root);
  const sheet = root.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
  sheet.textContent = viewQuark;
  document.body.append(wrap);
  if (!sheet.quarkInstance) {
    await waitForEvent(sheet, "quark-sheet-success");
  }
  const meter = onInstance?.(sheet.quarkInstance!);
  await settleCells(root);
  await flush();
  const budget = meter?.take();
  meter?.stop();
  return { root, quark: sheet.quarkInstance!, meter: budget };
};

const cellInput = (root: HTMLElement, ref: string) =>
  root.querySelector<HTMLInputElement>(`input[name="${ref}"]`)!;

const cellDisplay = (root: HTMLElement, ref: string) =>
  cellInput(root, ref).previousElementSibling as HTMLElement;

const commitCell = (root: HTMLElement, ref: string, value: string) => {
  const input = cellInput(root, ref);
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("cells-app view", () => {
  beforeEach(() => {
    Quark.moduleLoader = async (url: string) => {
      if (url.includes("cells-app")) return cellsApp;
      throw new Error(`unexpected @use module: ${url}`);
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes(".quark")) {
        return Promise.resolve(new Response(viewQuark, { status: 200 }));
      }
      return Promise.resolve(new Response("", { status: 200 }));
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Quark.moduleLoader = originalLoader;
    vi.restoreAllMocks();
  });

  it("renders the grid, evaluates a commit, and stays within the complexity budget", async () => {
    const evalSpy = vi.spyOn(cellsApp, "evalCell");
    /*
     * Mount phase: iterate renders 100 rows x 26 cells; each cell's `$ref`
     * binding write fans out to its `[bind-value]` reader. The meter needs
     * the instance, so it attaches on `quark-sheet-success` (before the
     * first paint of the iterate templates).
     */
    const mountMeter = mountCellsApp((quark) => measureComplexity(quark));
    const { root, quark, meter: mountBudget } = await mountMeter;
    expect(mountBudget).toMatchSnapshot("mount complexity");

    expect(root.querySelectorAll("thead th")).toHaveLength(COLS + 1);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(ROWS);
    expect(root.querySelectorAll("tbody input")).toHaveLength(CELL_COUNT);

    // A literal cell is a plain input: its committed text lands on the
    // <td>, and no formula is evaluated.
    commitCell(root, "A0", "2");
    await flush();
    expect(cellInput(root, "A0").closest("td")?.dataset.formula).toBe("2");
    expect(root.querySelector("form")?.dataset.revision).toBe("1");
    expect(cellDisplay(root, "A0").textContent).toBe("");
    expect(evalSpy).not.toHaveBeenCalled();

    const meter = measureComplexity(quark);
    commitCell(root, "B0", "=A0+3");
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(cellDisplay(root, "B0").textContent).toBe("5");
    // A commit re-derives formula cells only: one here, not the grid.
    expect(evalSpy).toHaveBeenCalledTimes(1);
    expect(budget.attributeRuns).toBe(1);
    expect(budget.schedulePaint).toBe(1);
    expect(budget.textContent).toBe(1);
    expect(budget.importNode).toBe(0);
    expectComplexity(budget);

    // dependents refresh on the next revision
    commitCell(root, "A0", "10");
    await flush();
    expect(cellDisplay(root, "B0").textContent).toBe("13");

    // a formula cell turned literal clears its result (inverse rule)
    commitCell(root, "B0", "7");
    await flush();
    expect(cellDisplay(root, "B0").textContent).toBe("");

    commitCell(root, "C0", "=C0");
    await flush();
    expect(cellDisplay(root, "C0").textContent).toBe("#CYCLE");
    commitCell(root, "D0", "=(");
    await flush();
    expect(cellDisplay(root, "D0").textContent).toBe("#ERROR");
  }, 180_000);
});
