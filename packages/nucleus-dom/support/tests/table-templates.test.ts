import { createRequire } from "node:module";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { createDom, supportTableTemplates } from "../../index";
import { dependencies } from "../../package.json";

const PLACEMENTS = {
  table: "<table><template><tr><td>a</td></tr></template></table>",
  thead: "<table><thead><template><tr><th>a</th></tr></template></thead></table>",
  tbody: "<table><tbody><template><tr><td>a</td></tr></template></tbody></table>",
  tfoot: "<table><tfoot><template><tr><td>a</td></tr></template></tfoot></table>",
  tr: "<table><tbody><tr><template><td>a</td></template></tr></tbody></table>",
  colgroup: "<table><colgroup><template><col></template></colgroup></table>",
  caption: "<table><caption><template><tr><td>a</td></tr></template></caption></table>",
  "a nested table":
    "<table><tbody><tr><td><table><tbody><template><tr><td>a</td></tr></template></tbody></table></td></tr></tbody></table>",
};

/** happy-dom's own parse of markup without table templates, recorded before the shim. */
const ORDINARY = {
  "<table><tr><td>a</td></tr></table>": "<table><tbody><tr><td>a</td></tr></tbody></table>",
  "<table><caption>c</caption><colgroup><col></colgroup><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>":
    "<table><caption>c</caption><colgroup><col></colgroup><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>",
  "<table><div>x</div><tr><td>y</td></tr></table>": "<div></div><table>x<tbody><tr><td>y</td></tr></tbody></table>",
  '<select><optgroup label="g"><option>1</option></optgroup><option selected>2</option></select>':
    '<select><optgroup label="g"><option>1</option></optgroup><option selected="">2</option></select>',
};

type Config = Record<string, { permittedDescendants?: string[] } | undefined>;

const { default: config } = createRequire(import.meta.url)("happy-dom/lib/config/HTMLElementConfig.js") as {
  default: Config;
};

describe("supportTableTemplates", () => {
  const { window, document } = createDom();
  const viaInnerHTML = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.innerHTML;
  };
  const viaDOMParser = (html: string) => new window.DOMParser().parseFromString(html, "text/html").body.innerHTML;

  it.each(Object.entries(PLACEMENTS))("keeps a <template> in %s where it is written", (_, html) => {
    expect([viaInnerHTML(html), viaDOMParser(html)]).toEqual([html, html]);
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("template")!.content.firstElementChild).not.toBeNull();
  });

  it("keeps rows written straight into a template, in any document of the process", () => {
    const rows = "<template><tr><td>a</td></tr></template>";
    expect(viaInnerHTML(rows)).toBe(rows);
    const host = globalThis.document.createElement("div");
    host.innerHTML = PLACEMENTS.tbody;
    expect(host.innerHTML).toBe(PLACEMENTS.tbody);
  });

  it("parses tables and selects without templates as before", () => {
    for (const [html, parsed] of Object.entries(ORDINARY)) {
      expect([viaInnerHTML(html), viaDOMParser(html)]).toEqual([parsed, parsed]);
    }
  });

  it("patches happy-dom's parser once", () => {
    supportTableTemplates(window);
    expect(config.tbody!.permittedDescendants!.filter((tag) => tag === "template")).toHaveLength(1);
  });

  it("throws, naming the pin, when the window's parser still moves templates out", () => {
    const table = config.table!;
    const { permittedDescendants } = table;
    // as a second happy-dom copy behind the window would parse
    table.permittedDescendants = permittedDescendants!.filter((tag) => tag !== "template");
    try {
      expect(() => supportTableTemplates(window)).toThrow(
        `nucleus-dom cannot keep <template>s in tables: this window's happy-dom is not the copy nucleus-dom patches (nucleus-dom pins happy-dom ${dependencies["happy-dom"]})`,
      );
    } finally {
      table.permittedDescendants = permittedDescendants;
    }
  });

  it("throws when happy-dom's parser config is laid out otherwise", () => {
    const { tr } = config;
    delete config.tr;
    try {
      expect(() => supportTableTemplates(window)).toThrow("happy-dom's parser no longer configures tr");
    } finally {
      config.tr = tr;
    }
  });
});
