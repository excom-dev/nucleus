import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildDocs } from "../../scripts/build-docs.mjs";
import { makeTempDir, packageJson, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");

const fullCem = {
  schemaVersion: "1.0.0",
  modules: [
    {
      path: "fx-el.ts",
      declarations: [
        {
          kind: "class",
          customElement: true,
          tagName: "fx-el",
          name: "FxEl",
          summary: "Primary summary.",
          attributes: [
            {
              name: "count",
              type: { text: "number" },
              description: "Count | with pipe\nand newline.",
              fieldName: "count",
              default: "3",
              values: [1, "", "two words", "1.5"],
            },
            { name: "on", type: { text: "boolean" }, fieldName: "on", default: "true" },
            { name: "off", type: { text: "boolean" }, fieldName: "off", default: "false" },
            { name: "odd", type: { text: "boolean" }, fieldName: "odd", default: "maybe" },
            { name: "n", type: "number", fieldName: "n", default: "nope" },
            { name: "raw", type: { expanded: "x" }, fieldName: "raw", default: 7 },
            { name: "shape", type: { text: "Shape", expanded: "{ a: 1 }" }, fieldName: "shape" },
            { name: "no-field" },
            { name: "st", fieldName: "st" },
            { name: "hy", fieldName: "hy" },
          ],
          members: [
            { kind: "field", name: "count", _neutron: { surface: "option" } },
            { kind: "field", name: "st", readonly: true },
            { kind: "field", name: "hy", _neutron: { surface: "hybrid" } },
            { kind: "method", name: "raw" },
          ],
          events: [{ name: "{tag}-change", description: "Changed on {tag}.", type: { text: "E", expanded: "CustomEvent & {}" } }],
          slots: [{ name: "-", description: "Default." }],
          cssProperties: [{ name: "--b", syntax: "<color>", default: "red", description: "B." }, { name: "--a" }],
          _neutron: {
            listens: [{ name: "submit", type: "SubmitEvent" }],
            commands: [{ name: "--go", description: "Goes." }],
            defaultActions: [{ name: "{tag}-change", description: "Applies." }],
            expectedChildren: [{ relationship: "child", selector: "template", required: true, description: "T." }, { relationship: "descendant", selector: "button", required: false }],
            cssClasses: [{ name: "raised", description: "R." }],
            cssAliases: [{ name: ":--fx-el", selectors: ["fx-el", ".fx"] }, { name: ":--fx-el--on", kind: "state" }],
            provisions: [{ name: "provision", type: { text: "P" }, description: "Payload." }],
          },
          mixins: [
            { name: "BaseEl", package: "@excom/base-el" },
            { name: "Local" },
            { name: "Missing", package: "@excom/missing" },
            { name: "Corrupt", package: "@excom/corrupt" },
          ],
        },
      ],
    },
    {
      path: "helper-mixin.ts",
      declarations: [{ kind: "mixin", name: "HelperMixin", summary: "Helper.", events: [{ name: "{tag}-x" }] }],
    },
    { path: "empty.ts", declarations: [{ kind: "class", customElement: true, tagName: "empty-el", name: "EmptyEl" }] },
  ],
};

const baseCem = {
  schemaVersion: "1.0.0",
  modules: [
    {
      path: "base-el.ts",
      declarations: [
        {
          kind: "mixin",
          name: "BaseEl",
          attributes: [
            { name: "count", type: { text: "number" }, fieldName: "count" },
            { name: "inherited", type: { text: "string" }, fieldName: "inherited", default: "x" },
          ],
          members: [{ kind: "field", name: "inherited" }],
          events: [{ name: "{tag}-base", description: "From base." }],
          slots: [{ name: "base-slot" }],
          cssProperties: [{ name: "--base" }],
          _neutron: {
            listens: [{ name: "base-listen" }],
            cssClasses: [{ name: "base-class" }],
            expectedChildren: [
              { relationship: "child", selector: "template", required: false },
              { relationship: "child", selector: "base-child", required: true },
            ],
          },
          mixins: [
            { name: "Deep", package: "@excom/deep" },
            { name: "FxEl", package: "@excom/fx-el" },
          ],
        },
      ],
    },
  ],
};

const deepCem = {
  schemaVersion: "1.0.0",
  modules: [
    {
      path: "deep.ts",
      declarations: [
        {
          kind: "mixin",
          name: "Deep",
          attributes: [{ name: "deep-attr", fieldName: "deepAttr" }],
          mixins: [{ name: "BaseEl", package: "@excom/base-el" }],
        },
      ],
    },
  ],
};

const README = `# fx-el

Intro with inline \`<include-content>\` code.

<include-content data-demo="basic"></include-content>

<live-demo src="fx-el/second/"></live-demo>

<live-demo src="fx-el/missing"/>

<include-content template-ref="/views/install-section/install-section.html"></include-content>

### API Reference

<include-content template-ref="/views/api-reference/api-reference.html"/>

<include-content template-ref="/views/unknown/unknown.html"></include-content>
`;

describe("buildDocs", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = makeTempDir("heft-rig-docs-");
  });
  afterAll(() => removeDir(tmp));

  it("renders README-skeleton docs for the primary element and plain docs for the rest", async () => {
    const root = path.join(tmp, "fx-el");
    writeFiles(root, {
      "package.json": packageJson("@excom/fx-el", {
        excom: { packageType: "kit-element" },
        peerDependencies: { "@excom/neutron": "^1" },
      }),
      "fx-el.css": ":host {}",
      "support/custom-elements.json": JSON.stringify(fullCem),
      "support/docs/README.md": README,
      "support/demos/basic.html": "<fx-el></fx-el>\n",
      "support/demos/second.html": "<fx-el second></fx-el>",
      "support/demos/third.html": "<fx-el third></fx-el>",
      "support/demos/index.html": "<html></html>",
      "support/demos/notes.txt": "x",
      "support/dist-docs/stale.md": "stale",
      "node_modules/@excom/base-el/support/custom-elements.json": JSON.stringify(baseCem),
      "node_modules/@excom/deep/support/custom-elements.json": JSON.stringify(deepCem),
      "node_modules/@excom/corrupt/support/custom-elements.json": "{ nope",
    });

    await buildDocs(root);
    const outDir = path.join(root, "support/dist-docs");
    expect(readdirSync(outDir).sort()).toEqual(["empty-el.md", "fx-el.md", "helper-mixin.md"]);

    const md = read(root, "support/dist-docs/fx-el.md");
    expect(md).toContain("Intro with inline `<include-content>` code.");
    expect(md).toContain("```html\n<fx-el></fx-el>\n```");
    expect(md).toContain("```html\n<fx-el second></fx-el>\n```");
    expect(md).toContain('<live-demo src="fx-el/missing"/>');
    expect(md).toContain('<include-content template-ref="/views/unknown/unknown.html"></include-content>');
    expect(md).toContain("`@excom/fx-el` v1.2.3");
    expect(md).toContain("pnpm add @excom/fx-el");
    expect(md).toContain('@import "@excom/fx-el/fx-el.css";');
    expect(md).toContain("| `@excom/neutron` | `^1` |");
    expect(md).not.toContain("\n## Installation\n");
    expect(md).not.toContain("\n## API\n");
    expect(md).toContain("### API Reference\n\n\n#### Attributes");
    expect(md).toContain(
      '| `count` | option | `number` | `3` | `1` \\| `""` \\| `two words` \\| `"1.5"` | Count \\| with pipe and newline. |  |',
    );
    expect(md).toContain("| `on` | option | `boolean` | `true` |");
    expect(md).toContain("| `off` | option | `boolean` | `false` |");
    expect(md).toContain("| `odd` | option | `boolean` | `\"maybe\"` |");
    expect(md).toContain("| `n` | option | `number` | `\"nope\"` |");
    expect(md).toContain("| `raw` | option |  | `7` |");
    expect(md).toContain("| `shape` | option | `Shape` (`{ a: 1 }`) |");
    expect(md).toContain("| `st` | state |");
    expect(md).toContain("| `hy` | hybrid |");
    expect(md).toContain("| `inherited` | option | `string` | `\"x\"` |  |  | `@excom/base-el` |");
    // Transitive ancestors collapse to the nearest ancestor that re-exposed them.
    expect(md).toContain("| `deep-attr` | option |  |  |  |  | `@excom/base-el` |");
    expect(md).toContain("| `fx-el-change` | `E` (`CustomEvent & {}`) | Changed on fx-el. |");
    expect(md).toContain("| `fx-el-base` |  | From base. | `@excom/base-el` |");
    expect(md).toContain("| `submit` | `SubmitEvent` |  |");
    expect(md).toContain("| `fx-el-change` | Applies. |");
    expect(md).toContain("| `template` | child | yes | T. |");
    expect(md).toContain("| `button` | descendant | no |  |");
    expect(md).toContain("| `base-child` | child | yes |  | `@excom/base-el` |");
    expect(md).toContain("| `--b` | `<color>` | `red` | B. |");
    expect(md).toContain("| `.raised` | R. |");
    expect(md).toContain("| `:--fx-el` | element | `fx-el`, `.fx` |  |");
    expect(md).toContain("| `:--fx-el--on` | state |  |  |");
    expect(md).toContain("| `provision` | `P` | Payload. |");
    expect(md).toContain("### Commands\n\n| Command | Action |\n| --- | --- |\n| `--go` | Goes. |");
    expect(md).toContain("## Demo sources\n\n### third\n\n```html\n<fx-el third></fx-el>\n```");
    expect(md).not.toContain("### second");

    const helper = read(root, "support/dist-docs/helper-mixin.md");
    expect(helper).toBe(
      [
        "# HelperMixin",
        "",
        "> Helper.",
        "",
        "**Kind:** Neutron mixin (composition base — not a registered element).",
        "",
        "## API",
        "",
        "### Fires",
        "",
        "| Name | Type | Description |",
        "| --- | --- | --- |",
        "| `{tag}-x` |  |  |",
        "",
      ].join("\n"),
    );

    expect(read(root, "support/dist-docs/empty-el.md")).toBe(
      "# `<empty-el>`\n\n**Tag:** `<empty-el>`\n",
    );
  });

  it("renders the generated skeleton when there is no README", async () => {
    const root = path.join(tmp, "plain");
    writeFiles(root, {
      "package.json": packageJson("@excom/plain", { excom: { packageType: "library" } }),
      "support/custom-elements.json": JSON.stringify({
        modules: [
          {
            declarations: [
              { kind: "class", customElement: true, tagName: "plain-el", name: "PlainEl", summary: "S.", slots: [{ name: "x" }] },
            ],
          },
        ],
      }),
      "support/demos/demo.html": "  <plain-el></plain-el>  ",
    });
    await buildDocs(root);
    const md = read(root, "support/dist-docs/plain-el.md");
    expect(md).toBe(
      [
        "# `<plain-el>`",
        "",
        "> S.",
        "",
        "**Tag:** `<plain-el>`",
        "",
        "## Installation",
        "",
        "`@excom/plain` v1.2.3",
        "",
        "```bash",
        "pnpm add @excom/plain",
        "```",
        "",
        "```bash",
        "npm install @excom/plain",
        "```",
        "",
        "```bash",
        "yarn add @excom/plain",
        "```",
        "",
        "### Import",
        "",
        "```ts",
        'import { /* … */ } from "@excom/plain";',
        "```",
        "",
        "## API",
        "",
        "### Slots",
        "",
        "| Name | Description |",
        "| --- | --- |",
        "| `x` |  |",
        "",
        "## Demo sources",
        "",
        "### demo",
        "",
        "```html",
        "<plain-el></plain-el>",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("appends install / API sections when the README does not include them", async () => {
    const root = path.join(tmp, "no-includes");
    writeFiles(root, {
      "package.json": packageJson("@excom/no-includes", { excom: { packageType: "kit-element" } }),
      "support/custom-elements.json": JSON.stringify({
        modules: [{ declarations: [{ kind: "class", customElement: true, tagName: "other-tag", name: "X", attributes: [{ name: "a" }], members: [] }] }],
      }),
      "support/docs/README.md": "# Title\n\nBody.\n\n<include-content template-ref=\"/views/api-reference/api-reference.html\"></include-content>\n",
    });
    await buildDocs(root);
    const md = read(root, "support/dist-docs/other-tag.md");
    expect(md).toContain("## Installation");
    expect(md).toContain('import "@excom/no-includes";');
    expect(md).toContain("#### Attributes");
    expect(md).not.toContain("\n## API\n");
    expect(md).not.toContain("Demo sources");
  });

  it("leaves a README empty of API when the declaration has none", async () => {
    const root = path.join(tmp, "empty-api");
    writeFiles(root, {
      "package.json": packageJson("@excom/empty-api", { excom: { packageType: "kit-element" } }),
      "support/custom-elements.json": JSON.stringify({
        modules: [{ declarations: [{ kind: "class", customElement: true, tagName: "empty-api", name: "X" }] }],
      }),
      "support/docs/README.md": "# T\n\n<include-content template-ref=\"/views/api-reference/api-reference.html\"/>",
    });
    await buildDocs(root);
    const md = read(root, "support/dist-docs/empty-api.md");
    expect(md).toBe("# T\n\n## Installation\n\n`@excom/empty-api` v1.2.3\n\n```bash\npnpm add @excom/empty-api\n```\n\n```bash\nnpm install @excom/empty-api\n```\n\n```bash\nyarn add @excom/empty-api\n```\n\n### Import\n\n```ts\nimport \"@excom/empty-api\";\n```\n");
  });

  it("copies support/docs for packages without a CEM", async () => {
    const root = path.join(tmp, "site");
    writeFiles(root, {
      "package.json": packageJson("@excom/site"),
      "support/docs/QUICK_START.md": "# Quick",
      "support/docs/Other.md": "# Other",
      "support/docs/INTERNAL.md": "# contributor notes, never copied",
      "support/docs/notes.txt": "x",
      "support/dist-docs/stale.md": "stale",
    });
    await buildDocs(root);
    expect(readdirSync(path.join(root, "support/dist-docs"))).toEqual(["docs"]);
    expect(readdirSync(path.join(root, "support/dist-docs/docs")).sort()).toEqual(["other.md", "quick_start.md"]);
    expect(read(root, "support/dist-docs/docs/quick_start.md")).toBe("# Quick");
  });

  it("does nothing for packages without a CEM or docs, or with a corrupt / empty CEM", async () => {
    const none = path.join(tmp, "none");
    writeFiles(none, { "package.json": packageJson("@excom/none") });
    await buildDocs(none);
    expect(existsSync(path.join(none, "support"))).toBe(false);

    const noMd = path.join(tmp, "no-md");
    writeFiles(noMd, { "package.json": packageJson("@excom/no-md"), "support/docs/x.txt": "x" });
    await buildDocs(noMd);
    expect(existsSync(path.join(noMd, "support/dist-docs"))).toBe(false);

    const corrupt = path.join(tmp, "corrupt");
    writeFiles(corrupt, {
      "package.json": packageJson("@excom/corrupt"),
      "support/custom-elements.json": "{ nope",
      "support/docs/A.md": "# A",
    });
    await buildDocs(corrupt);
    expect(read(corrupt, "support/dist-docs/docs/a.md")).toBe("# A");

    const empty = path.join(tmp, "empty");
    writeFiles(empty, {
      "package.json": packageJson("@excom/empty"),
      "support/custom-elements.json": JSON.stringify({ modules: [{}] }),
    });
    await buildDocs(empty);
    expect(existsSync(path.join(empty, "support/dist-docs"))).toBe(false);
  });
});
