import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { commit, evalCell, range } from "../../public/views/cells-app/cells-app";

/** A tiny grid: one `<td><output></output><input name=ref></td>` per ref. */
const mountGrid = (cells: Record<string, string>) => {
  const form = document.createElement("form");
  form.innerHTML = `<table><tbody><tr>${Object.entries(cells)
    .map(
      ([ref, value]) =>
        `<td data-formula="${value}"><output></output><input name="${ref}" value="${value}"></td>`
    )
    .join("")}</tr></tbody></table>`;
  document.body.append(form);
  const td = (ref: string) =>
    form.querySelector<HTMLInputElement>(`input[name="${ref}"]`)!.closest(
      "td"
    )!;
  return { form, td };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("range", () => {
  it("builds [0, n)", () => {
    expect(range(3)).toEqual([0, 1, 2]);
    expect(range(0)).toEqual([]);
  });
});

describe("commit", () => {
  it("reflects the input text onto the cell and bumps the form revision", () => {
    const { form, td } = mountGrid({ A0: "1" });
    const input = form.querySelector("input")!;
    input.value = "=A0+1";
    commit({ target: input });
    expect(td("A0").dataset.formula).toBe("=A0+1");
    expect(form.dataset.revision).toBe("1");
    commit({ target: input });
    expect(form.dataset.revision).toBe("2");
  });
});

describe("evalCell", () => {
  it("returns literal text unchanged", () => {
    const { td } = mountGrid({ A0: "hello", B0: "  42 " });
    expect(evalCell(td("A0"))).toBe("hello");
    expect(evalCell(td("B0"))).toBe("42");
  });

  it("evaluates arithmetic with precedence, parentheses, unary signs and cell refs", () => {
    const { td } = mountGrid({
      A0: "2",
      A1: "3",
      B0: "=A0+A1*2",
      B1: "=(A0+A1)*2",
      B2: "=-A0+ +A1",
      B3: "=10/4",
      B4: "=10%4",
      B5: "=1.5+.5",
      B6: "=A0-A1",
      B7: "=1/3",
    });
    expect(evalCell(td("B0"))).toBe(8);
    expect(evalCell(td("B1"))).toBe(10);
    expect(evalCell(td("B2"))).toBe(1);
    expect(evalCell(td("B3"))).toBe(2.5);
    expect(evalCell(td("B4"))).toBe(2);
    expect(evalCell(td("B5"))).toBe(2);
    expect(evalCell(td("B6"))).toBe(-1);
    expect(evalCell(td("B7"))).toBe(0.333333);
  });

  it("chains formulas and treats non-numeric / empty / missing refs as 0", () => {
    const { td } = mountGrid({
      A0: "4",
      A1: "=A0*2",
      A2: "=A1+A0",
      A3: "text",
      A4: "=A3+1",
      A5: "",
      A6: "=A5+Z99+2",
    });
    expect(evalCell(td("A2"))).toBe(12);
    expect(evalCell(td("A4"))).toBe(1);
    expect(evalCell(td("A6"))).toBe(2);
  });

  it("reports cycles as #CYCLE", () => {
    const { td } = mountGrid({
      A0: "=A1",
      A1: "=A0",
      A2: "=A2+1",
      A3: "=A0*2",
    });
    expect(evalCell(td("A0"))).toBe("#CYCLE");
    expect(evalCell(td("A1"))).toBe("#CYCLE");
    expect(evalCell(td("A2"))).toBe("#CYCLE");
    // a cycle reached through another cell is still a cycle
    expect(evalCell(td("A3"))).toBe("#CYCLE");
  });

  it("reports malformed or non-finite formulas as #ERROR", () => {
    const { td } = mountGrid({
      A0: "=",
      A1: "=(1+2",
      A2: "=1+",
      A3: "=1 2",
      A4: "=foo",
      A5: "=1/0",
      A6: "=$",
      A7: "=)",
      A8: "=A1",
    });
    expect(evalCell(td("A0"))).toBe("#ERROR");
    expect(evalCell(td("A1"))).toBe("#ERROR");
    expect(evalCell(td("A2"))).toBe("#ERROR");
    expect(evalCell(td("A3"))).toBe("#ERROR");
    expect(evalCell(td("A4"))).toBe("#ERROR");
    expect(evalCell(td("A5"))).toBe("#ERROR");
    expect(evalCell(td("A6"))).toBe("#ERROR");
    expect(evalCell(td("A7"))).toBe("#ERROR");
    // a malformed dependency poisons the dependent cell too
    expect(evalCell(td("A8"))).toBe("#ERROR");
  });
});
