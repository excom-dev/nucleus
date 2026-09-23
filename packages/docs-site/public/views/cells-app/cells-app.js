/** Cells example helpers (`@use "/views/cells-app/cells-app.js"`). */

/** `[0, 1, …, n - 1]`: Quark has no range literal (`iterate(range(100))`). */
export const range = (n) => Array.from({ length: n }, (_, i) => i);

/**
 * `change` on the grid (`:scope { @on change commit; }`): reflect the
 * committed text onto the cell and bump the grid's revision. Formula cells
 * re-derive on the revision; nothing else runs.
 * @param {Event & { target: HTMLInputElement }} event
 */
export const commit = ({ target }) => {
  const form = target.form;
  target.closest("td").dataset.formula = target.value;
  form.dataset.revision = String(Number(form.dataset.revision ?? 0) + 1);
};

// Pure formula math from here down.

const CELL_REF = /^[A-Z]\d{1,2}$/;
const CELL_TOKEN = /\d+(?:\.\d+)?|\.\d+|[A-Z]\d{1,2}|[-+*/%()]|\S/g;

/**
 * Recursive-descent evaluator for `+ - * / %`, parentheses, unary sign,
 * numbers and cell refs. No `eval` / `new Function` — the formula is user
 * input.
 * @param {string} src
 * @param {(ref: string) => number} lookup
 */
const parseFormula = (src, lookup) => {
  const tokens = src.match(CELL_TOKEN) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = () => {
    const t = next();
    if (t === undefined) throw new Error("unexpected end");
    if (t === "(") {
      const v = expr();
      if (next() !== ")") throw new Error("expected )");
      return v;
    }
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (CELL_REF.test(t)) return lookup(t);
    if (/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return Number(t);
    throw new Error(`bad token ${t}`);
  };
  const term = () => {
    let v = primary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = primary();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  if (i !== tokens.length) throw new Error("trailing input");
  return v;
};

class CellCycleError extends Error {}

/**
 * The committed text of `ref`: the named `<input>` in the grid's form.
 * @param {HTMLFormElement} form
 * @param {string} ref
 */
const rawOf = (form, ref) => (form.elements.namedItem(ref)?.value ?? "").trim();

/**
 * @param {HTMLFormElement} form
 * @param {string} ref
 * @param {ReadonlySet<string>} visiting
 * @returns {string | number}
 */
const evalRef = (form, ref, visiting) => {
  const raw = rawOf(form, ref);
  if (!raw.startsWith("=")) return raw;
  if (visiting.has(ref)) throw new CellCycleError(ref);
  const seen = new Set(visiting).add(ref);
  const value = parseFormula(
    raw.slice(1),
    (r) => Number(evalRef(form, r, seen)) || 0
  );
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : "#ERROR";
};

/**
 * Cells example: evaluate a cell (`<td>`) from its `<input>`'s text. A value
 * starting with `=` is a formula over other cells (`A0`…`Z99`); anything
 * else is literal text. Refs to non-numeric cells count as 0 (as in the Vue
 * 7GUIs demo); cycles and bad formulas render as `#CYCLE` / `#ERROR`.
 * @param {HTMLElement} td
 * @returns {string | number}
 */
export const evalCell = (td) => {
  const input = td.querySelector("input");
  try {
    return evalRef(input.form, input.name, new Set());
  } catch (e) {
    return e instanceof CellCycleError ? "#CYCLE" : "#ERROR";
  }
};
