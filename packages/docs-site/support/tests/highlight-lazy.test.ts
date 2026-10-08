/**
 * `/shell` creates no highlighter: the first code block that is not
 * highlighted yet loads `/highlight`. One module state for the file, so the
 * tests run in order: nothing loaded, the first need, then loaded.
 */
import "@excom/include-content";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/nucleus-test";

const shiki = { created: 0 };

// not hoisted: the modules under test are imported after it, below
vi.doMock("shiki", async (importOriginal) => {
  const real = await importOriginal<typeof import("shiki")>();
  return {
    ...real,
    createHighlighter: (...args: Parameters<typeof real.createHighlighter>) => {
      shiki.created++;
      return real.createHighlighter(...args);
    },
  };
});

const { upgradeTemplateCode } = await import("../../shell");

/** A markdown code block (`render-markdown.mjs`), wired as `package.quark` wires it. */
const codeBlock = (template: string) => {
  const host = document.createElement("include-content");
  host.setAttribute("data-language", "js");
  host.innerHTML = `<template>${template}</template>`;
  host.addEventListener("include-content-render", upgradeTemplateCode);
  document.body.append(host);
  return host;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the highlighter", () => {
  it("is not created by `/shell`", () => {
    expect(shiki.created).toBe(0);
  });

  it("is not loaded by a block that is highlighted already (a prerendered page)", async () => {
    const highlighted = `<pre class="shiki"><code>const a = 1;</code></pre>`;
    const host = codeBlock(highlighted);
    const rendered = waitForEvent(host, "include-content-did-render");
    host.setAttribute("is-active", "");
    await rendered;
    expect(host.querySelector("pre.shiki")?.textContent).toBe("const a = 1;");
    expect(host.querySelector("template")!.innerHTML).toBe(highlighted);
    expect(shiki.created).toBe(0);
  });

  it("is loaded by the first block that is not, which renders once highlighted", async () => {
    const host = codeBlock("const a = 1;");
    const renders = vi.fn();
    host.addEventListener("include-content-did-render", renders);
    const rendered = waitForEvent(host, "include-content-did-render");
    host.setAttribute("is-active", "");
    // held: the plain code is never shown
    await wait(0);
    expect(host.querySelector(":scope > :not(template)")).toBeNull();
    await rendered;
    expect(shiki.created).toBe(1);
    expect(host.querySelector("pre.shiki")?.textContent).toBe("const a = 1;");
    expect(host.querySelector("[bind-copy-button]")).not.toBeNull();
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it("then highlights a block as it renders, without a second highlighter", () => {
    const template = document.createElement("template");
    template.innerHTML = "const b = 2;";
    const target = document.createElement("div");
    target.append(template);
    const preventDefault = vi.fn();
    upgradeTemplateCode({ target, preventDefault });
    expect(template.content.querySelector("pre.shiki")?.textContent).toBe(
      "const b = 2;"
    );
    expect(preventDefault).not.toHaveBeenCalled();
    expect(shiki.created).toBe(1);
  });
});
