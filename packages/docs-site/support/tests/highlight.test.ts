import { afterEach, describe, expect, it } from "@excom/nucleus-test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  formatCode,
  renderLang,
  renderLangCopy,
  renderPre,
  renderPreFormatted,
} from "../../highlight";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("formatCode", () => {
  it("re-indents html and keeps quark-sheet bodies one level past the open tag", () => {
    const src = [
      "<div>",
      "<quark-sheet>",
      "      p { color: red; }",
      "",
      "          span { color: blue; }",
      "</quark-sheet>",
      "<p>hi</p>",
      "</div>",
      "\n\n",
    ].join("\n");
    expect(formatCode(src)).toBe(
      [
        "<div>",
        "    <quark-sheet>",
        "        p { color: red; }",
        "",
        "            span { color: blue; }",
        "    </quark-sheet>",
        "    <p>hi</p>",
        "</div>",
      ].join("\n")
    );
  });

  it("leaves empty and single-line sheets untouched", () => {
    const empty = "<div>\n<quark-sheet>\n\n</quark-sheet>\n</div>";
    expect(formatCode(empty)).toContain("<quark-sheet>\n\n</quark-sheet>");
    const inline = "<div>\n<quark-sheet>p { color: red; }</quark-sheet>\n</div>";
    expect(formatCode(inline)).toContain(
      "<quark-sheet>p { color: red; }</quark-sheet>"
    );
  });
});

describe("renderLang / renderPre", () => {
  it("returns empty for empty input and highlights known + raw shiki languages", () => {
    expect(renderLang("", "html")).toBe("");
    expect(renderLang("<p>hi</p>", "html")).toContain('class="shiki');
    expect(renderLang("const a = 1;", "js")).toContain("shiki");
    expect(renderLang("<my-el></my-el>", "html-custom-elements")).toContain(
      "shiki"
    );
    expect(renderLang("p { color: red; }", "quark")).toContain("shiki");
  });

  it("normalizes CRLF and keeps empty lines with a ZWSP", () => {
    const out = renderLang("a\r\n\r\nb\rc", "html");
    expect(out).toContain("​");
    expect((out.match(/class="line"/g) ?? []).length).toBe(4);
    expect(out).not.toContain("bind-copy-button");
  });

  it("appends a copy button when asked", () => {
    expect(renderLang("x", "text", { includeCopyButton: true })).toContain(
      "<div bind-copy-button></div>"
    );
    expect(renderLangCopy("x", "text")).toContain("bind-copy-button");
  });

  it("renderPre re-renders the overlay from the target value / innerHTML", () => {
    document.body.innerHTML = `
      <div class="code-editor" data-language="css">
        <textarea>p { color: red; }</textarea>
        <div data-highlight></div>
      </div>`;
    const textarea = document.querySelector("textarea")!;
    const overlay = document.querySelector("[data-highlight]")!;
    renderPre({ target: textarea });
    expect(overlay.innerHTML).toContain("shiki");
    expect(overlay.innerHTML).toContain("color");

    // custom event carrying the target in `detail`, html default language
    document.body.innerHTML = `
      <div>
        <div bind-source>&lt;p&gt;hi&lt;/p&gt;</div>
        <div data-highlight></div>
      </div>`;
    const source = document.querySelector("[bind-source]")!;
    const overlay2 = document.querySelector("[data-highlight]")!;
    renderPreFormatted({ target: source, detail: { target: source } });
    expect(overlay2.innerHTML).toContain("shiki");
    expect(overlay2.innerHTML).toContain("hi");
  });

  it("renderPre keeps an overlay that shows the same code already (a prerendered page)", () => {
    document.body.innerHTML = `
      <div data-language="css">
        <textarea>p { color: red; }</textarea>
        <div data-highlight></div>
      </div>`;
    const textarea = document.querySelector("textarea")!;
    const overlay = document.querySelector("[data-highlight]")!;
    renderPre({ target: textarea });
    const pre = overlay.firstElementChild;
    renderPre({ target: textarea });
    expect(overlay.firstElementChild).toBe(pre);
    textarea.value = "p { color: blue; }";
    renderPre({ target: textarea });
    expect(overlay.firstElementChild).not.toBe(pre);
    expect(overlay.textContent).toBe("p { color: blue; }");
  });
});

describe("shiki grammar imports", () => {
  // `@use "/shell"` is a native `import()` in the browser, so the highlighter's
  // grammar imports must be something Vite dev can rewrite. es-module-lexer
  // does not recognise a `with { type: "json", }` clause (trailing comma) as
  // import attributes, Vite then leaves the clause in place while serving the
  // JSON as a JS module, and the browser rejects the MIME type.
  it("carry import attributes es-module-lexer can strip", () => {
    const entry = createRequire(import.meta.url).resolve(
      "@excom/nucleus-quark-highlighter/shiki"
    );
    const source = readFileSync(entry, "utf8");
    const clauses =
      source.match(/\bfrom\s+"[^"]+"\s+with\s*\{[^}]*\}/g) ?? [];
    expect(clauses.length).toBeGreaterThan(0);
    for (const clause of clauses) {
      expect(clause).not.toMatch(/,\s*\}$/);
    }
  });
});
