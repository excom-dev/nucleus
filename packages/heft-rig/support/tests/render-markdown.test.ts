import { describe, expect, it } from "vitest";
import {
  isRelativeLink,
  renderMarkdown,
  renderMarkdownInline,
} from "../../scripts/render-markdown.mjs";

describe("renderMarkdown", () => {
  it("returns empty for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
    expect(renderMarkdownInline("")).toBe("");
  });

  it("gives headings stable md-* ids based on their text", () => {
    expect(renderMarkdown("# Quick `Start`!\n\n## -Sub-")).toBe(
      '<h1 id="md-quick-start">Quick <code>Start</code>!</h1>\n<h2 id="md-sub">-Sub-</h2>\n',
    );
  });

  it("wraps fenced code in include-content with escaped text and first language word", () => {
    expect(renderMarkdown("```html live\n<a href=\"x\">&</a>\n```")).toBe(
      '<include-content data-language="html"><template>&lt;a href="x"&gt;&amp;&lt;/a&gt;</template></include-content>\n',
    );
    expect(renderMarkdown("```\nplain\n```")).toBe(
      '<include-content data-language=""><template>plain</template></include-content>\n',
    );
  });

  it("treats indented code blocks as language-less includes", () => {
    expect(renderMarkdown("    indented\n")).toBe(
      '<include-content data-language=""><template>indented\n</template></include-content>\n',
    );
  });

  it("renders inline markdown without paragraph wrappers", () => {
    expect(renderMarkdownInline("Use `code` and *em*")).toBe(
      "Use <code>code</code> and <em>em</em>",
    );
  });

  it("renders relative links as spa-a and keeps external / hash links as a", () => {
    expect(renderMarkdownInline("[Intro](/docs/introduction)")).toBe(
      '<spa-a route-href="/docs/introduction" role="link">Intro</spa-a>',
    );
    expect(renderMarkdownInline('[P](./PROPS.md#md-x "Props & more")')).toBe(
      '<spa-a route-href="./PROPS.md#md-x" role="link" title="Props &amp; more">P</spa-a>',
    );
    expect(renderMarkdownInline("[`code`](../x)")).toBe(
      '<spa-a route-href="../x" role="link"><code>code</code></spa-a>',
    );
    expect(renderMarkdownInline("[ext](https://example.com/a?b=1)")).toBe(
      '<a href="https://example.com/a?b=1">ext</a>',
    );
    expect(renderMarkdownInline("[mail](mailto:a@b.c)")).toBe('<a href="mailto:a@b.c">mail</a>');
    expect(renderMarkdownInline("[cdn](//cdn.example.com/x)")).toBe(
      '<a href="//cdn.example.com/x">cdn</a>',
    );
    expect(renderMarkdownInline("[same page](#md-usage)")).toBe('<a href="#md-usage">same page</a>');
    expect(renderMarkdown("See [a](/x) and [b](http://y).\n")).toBe(
      '<p>See <spa-a route-href="/x" role="link">a</spa-a> and <a href="http://y">b</a>.</p>\n',
    );
  });

  it("isRelativeLink accepts paths and relative references only", () => {
    expect(["/docs/a", "./A.md", "../b", "page", "a/b#c"].map(isRelativeLink)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      ["https://x", "HTTP://x", "mailto:a@b", "//host/x", "#hash", "", undefined].map(isRelativeLink),
    ).toEqual([false, false, false, false, false, false, false]);
  });
});
