import { HAPPY_DOM } from "./happy-dom";
import { builtin } from "./node";
import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/table-templates");
// where browsers keep a `<template>`, and what may sit directly inside one
const HOLD_TEMPLATES = ["table", "colgroup", "thead", "tbody", "tfoot", "tr"];
const IN_TEMPLATES = [
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
];

type Config = Record<
  string,
  { permittedDescendants?: string[]; permittedParents?: string[] } | undefined
>;

const fail = (reason: string) => {
  throw new Error(
    `nucleus-dom cannot keep <template>s in tables: ${reason} (nucleus-dom pins happy-dom ${HAPPY_DOM})`
  );
};

/**
 * Keeps a `<template>` where it is written in a table (`table`, `colgroup`,
 * `thead`, `tbody`, `tfoot`, `tr`), rows, cells and columns inside it, as
 * browsers do: table rows rendered from a template (`iterate()`). happy-dom
 * moves the template out of the table and spills its rows in. Patches
 * happy-dom's parser, so it applies to every window in the process; throws
 * when `win`'s happy-dom is another copy.
 */
export function supportTableTemplates(
  win: DomWindow | typeof globalThis
): void {
  const require = builtin("node:module").createRequire(import.meta.url);
  const { default: config } =
    require("happy-dom/lib/config/HTMLElementConfig.js") as { default: Config };
  const unknown = [...HOLD_TEMPLATES, ...IN_TEMPLATES].filter(
    (tag) => !config[tag]
  );
  if (unknown.length)
    fail(`happy-dom's parser no longer configures ${unknown.join(", ")}`);
  if (claim(config, SHIMMED)) {
    HOLD_TEMPLATES.forEach((tag) =>
      config[tag]!.permittedDescendants?.push("template")
    );
    IN_TEMPLATES.forEach((tag) =>
      config[tag]!.permittedParents?.push("template")
    );
  }
  const probe = win.document.createElement("div");
  probe.innerHTML = "<table><template></template></table>";
  if (probe.firstElementChild?.firstElementChild?.localName !== "template")
    fail("this window's happy-dom is not the copy nucleus-dom patches");
}
