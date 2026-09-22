import { format } from "../../index";
import { parse, QuarkParseError } from "@excom/quark-parser";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("format: rules and declarations", () => {
  it("normalizes indentation, spacing, and semicolons", () => {
    const input = `main{   color:red;\n\n\n\n  span   {content:"hi"}\n}`;
    expect(format(input)).toBe(
      `main {
  color: red;

  span {
    content: "hi";
  }
}
`
    );
  });

  it("puts each selector of a list on its own line", () => {
    expect(format(`a,b span,c[open] { x: 1; }`)).toBe(
      `a,
b span,
c[open] {
  x: 1;
}
`
    );
  });

  it("prints combinators and pseudo selectors", () => {
    const input = `section[aria-label="preview"]>template{x:1;}
li:not([is-active],.done)+ul::before{y:2;}
&:has(include-content[is-active]){z:3;}`;
    expect(format(input)).toBe(
      `section[aria-label="preview"] > template {
  x: 1;
}
li:not([is-active], .done) + ul::before {
  y: 2;
}
&:has(include-content[is-active]) {
  z: 3;
}
`
    );
  });
});

describe("format: Quark accessor deviations", () => {
  it("prints dot accessors compactly", () => {
    expect(
      format(`a { x: $my-var . myProp ; y: prop("provision") . body ; }`)
    ).toBe(
      `a {
  x: $my-var.myProp;
  y: prop("provision").body;
}
`
    );
  });

  it("prints bracket accessors compactly", () => {
    expect(format(`a { x: $my-var[ 'my-prop-2' ]; y: $list[ $i ]; }`)).toBe(
      `a {
  x: $my-var['my-prop-2'];
  y: $list[$i];
}
`
    );
  });

  it("prints chained calls and accessors compactly", () => {
    const input = `a { $ref: closest("include-content[data-demo]") . getAttribute( "data-demo" ); }`;
    expect(format(input)).toBe(
      `a {
  $ref: closest("include-content[data-demo]").getAttribute("data-demo");
}
`
    );
  });
});

describe("format: expressions", () => {
  it("spaces binary operators and preserves precedence parens", () => {
    const input = `a { x: 1+2 * 3; y: ($a or $b)and $c; z: $a or($b and $c); }`;
    expect(format(input)).toBe(
      `a {
  x: 1 + 2 * 3;
  y: ($a or $b) and $c;
  z: $a or $b and $c;
}
`
    );
  });

  it("re-parses to an equivalent precedence tree", () => {
    const input = `a { x: (1 + 2) * 3; y: 1 + (2 * 3); }`;
    const output = format(input);
    expect(output).toContain("x: (1 + 2) * 3;");
    expect(output).toContain("y: 1 + 2 * 3;");
  });

  it("formats if() arms", () => {
    const input = `a { content: if( item.inheritedFrom :template("#x") ;else:  none ); }`;
    expect(format(input)).toBe(
      `a {
  content: if(item.inheritedFrom: template("#x"); else: none);
}
`
    );
  });

  it("formats lists and maps", () => {
    const input = `a { m: (x:1,y:2); l: 1px  2px   3px; b: [1,2, 3]; }`;
    expect(format(input)).toBe(
      `a {
  m: (x: 1, y: 2);
  l: 1px 2px 3px;
  b: [1, 2, 3];
}
`
    );
  });

  it("formats interpolations in urls and strings", () => {
    expect(
      format(`.icon { background: url(/img/#{$name}.svg); content:"a #{$b} c" }`)
    ).toBe(
      `.icon {
  background: url(/img/#{$name}.svg);
  content: "a #{$b} c";
}
`
    );
  });
});

describe("format: comments and blank lines", () => {
  it("preserves comments in place", () => {
    const input = `/* header */
a {
  /* leading note */
  x: 1; /* trailing note */
}`;
    expect(format(input)).toBe(
      `/* header */
a {
  /* leading note */
  x: 1; /* trailing note */
}
`
    );
  });

  it("collapses runs of blank lines to one", () => {
    expect(format(`a { x: 1; }\n\n\n\n\nb { y: 2; }`)).toBe(
      `a {
  x: 1;
}

b {
  y: 2;
}
`
    );
  });
});

describe("format: at-rules", () => {
  it("formats @use", () => {
    const input = `@use   "/import-files"   as   * ;\n@use "/lib/list" as list;\n@use "/lib/math";`;
    expect(format(input)).toBe(
      `@use "/import-files" as *;
@use "/lib/list" as list;
@use "/lib/math";
`
    );
  });

  it("formats @scope blocks", () => {
    const input = `@scope{:scope{data-x:1}ul li{content:item.name}}`;
    expect(format(input)).toBe(
      `@scope {
  :scope {
    data-x: 1;
  }
  ul li {
    content: item.name;
  }
}
`
    );
  });

  it("formats @on statements: event lists as written, options as expressions", () => {
    const input = `form{@on   submit   (prevent-default ,handle:saveDraft($draft)) ;@on "super-form-success",reset(handle:follow)}`;
    expect(format(input)).toBe(
      `form {
  @on submit (prevent-default, handle: saveDraft($draft));
  @on "super-form-success", reset (handle: follow);
}
`
    );
  });

  it("formats @on options: flags bare, values as expressions, empty group dropped, long groups one per line", () => {
    const input = `ul{@on click(target:"li[data-id]",once,debounce:100*3,key:"Shift+K",host:window,handle:pick);@on keydown (  self , capture ){is-open:none;}@on input(){x:1;}}`;
    const expected = `ul {
  @on click (
    target: "li[data-id]",
    once,
    debounce: 100 * 3,
    key: "Shift+K",
    host: window,
    handle: pick
  );
  @on keydown (self, capture) {
    is-open: none;
  }
  @on input {
    x: 1;
  }
}
`;
    expect(format(input)).toBe(expected);
    expect(format(expected)).toBe(expected);
    const after = (parse(expected).body[0] as any).block.body;
    expect(after[0].options.map((o: any) => o.name)).toEqual([
      "target",
      "once",
      "debounce",
      "key",
      "host",
      "handle",
    ]);
    expect(after[1].options.map((o: any) => o.name)).toEqual([
      "self",
      "capture",
    ]);
  });

  it("formats handle lists and other expression values (calls, members, operators, if())", () => {
    const input = `button{@on click(prevent-default,handle:(resetDemo( $src ),api.follow,item.name.trim(),3+$n*2,if($a:1;else:2)));}`;
    expect(format(input)).toBe(
      `button {
  @on click (
    prevent-default,
    handle: (
      resetDemo($src),
      api.follow,
      item.name.trim(),
      3 + $n * 2,
      if($a: 1; else: 2)
    )
  );
}
`
    );
  });

  it("formats @on blocks with several events and nested statements", () => {
    const input = `form{@on input,change{data-draft:event.target.value;}@on submit (prevent-default,handle:save){is-saved:"";#status{content:"saved";}}@on reset{}}`;
    const expected = `form {
  @on input, change {
    data-draft: event.target.value;
  }
  @on submit (prevent-default, handle: save) {
    is-saved: "";
    #status {
      content: "saved";
    }
  }
  @on reset {
  }
}
`;
    expect(format(input)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  it("formats @dispatch and @command statements like @on's head", () => {
    const input = `button{@on click{@dispatch   cart-add,"cart:changed"(detail:(sku:$sku,qty:1),target:"cart-view",bubbles:false);@command --refresh(target:"#feed");@dispatch ping}}`;
    const expected = `button {
  @on click {
    @dispatch cart-add, "cart:changed" (
      detail: (sku: $sku, qty: 1),
      target: "cart-view",
      bubbles: false
    );
    @command --refresh (target: "#feed");
    @dispatch ping;
  }
}
`;
    expect(format(input)).toBe(expected);
    expect(format(expected)).toBe(expected);
    const on = (parse(expected).body[0] as any).block.body[0];
    expect(on.block.body.map((s: any) => s.name)).toEqual([
      "dispatch",
      "command",
      "dispatch",
    ]);
  });

  it("keeps @on in place among declarations, nested rules, comments and blank lines", () => {
    const input = `form {
  $draft: none;
  @on submit (prevent-default, handle: save($draft)); /* trailing */


  &[is-locked] { @on submit (once, handle: save($draft)); }
  /* block */
  @on "custom:evt" (handle: a);
  data-x: 1;
}
@on load (handle: boot);`;
    expect(format(input)).toBe(
      `form {
  $draft: none;
  @on submit (prevent-default, handle: save($draft)); /* trailing */

  &[is-locked] {
    @on submit (once, handle: save($draft));
  }
  /* block */
  @on "custom:evt" (handle: a);
  data-x: 1;
}
@on load (handle: boot);
`
    );
  });

  it("formats @delay blocks and @warn / @debug statements inside rules", () => {
    const input = `button[data-copy]{@on click{data-copied:"";@delay   2000{data-copied:none;}}@delay $ms*2 {is-stale:"";span{content:none;}}}img:not([alt]){@warn   "img needs alt" ;@debug "size",attr("width");}`;
    const expected = `button[data-copy] {
  @on click {
    data-copied: "";
    @delay 2000 {
      data-copied: none;
    }
  }
  @delay $ms * 2 {
    is-stale: "";
    span {
      content: none;
    }
  }
}
img:not([alt]) {
  @warn "img needs alt";
  @debug "size", attr("width");
}
`;
    expect(format(input)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  it("formats @view-transition blocks: options normalized, empty group dropped, long groups wrapped", () => {
    const input = `provider-fetch[is-success]{@view-transition(types:"todo-change",timeout:1500){ul{content:iterate($todos,none,"id");}}@view-transition  ( ){data-x:1;}}@view-transition(types:"a b",timeout:300*5,delay:200,first-render,if-active:replace,until:"[is-success], [is-error]"){#out{content:"done";}}`;
    const expected = `provider-fetch[is-success] {
  @view-transition (types: "todo-change", timeout: 1500) {
    ul {
      content: iterate($todos, none, "id");
    }
  }
  @view-transition {
    data-x: 1;
  }
}
@view-transition (
  types: "a b",
  timeout: 300 * 5,
  delay: 200,
  first-render,
  if-active: replace,
  until: "[is-success], [is-error]"
) {
  #out {
    content: "done";
  }
}
`;
    expect(format(input)).toBe(expected);
    expect(format(expected)).toBe(expected);
    const after = parse(expected).body as any[];
    expect(after[1].options.map((o: any) => o.name)).toEqual([
      "types",
      "timeout",
      "delay",
      "first-render",
      "if-active",
      "until",
    ]);
  });

  it("keeps @view-transition in place among declarations, @on blocks, comments and blank lines", () => {
    const input = `form {
  data-x: 1; /* trailing */


  @view-transition (types: "save") { is-saved: ""; @on reset { is-saved: none; } }
  /* block */
  @on submit (prevent-default) { @view-transition { #status { content: "saved"; } } }
  @view-transition {
  }
}`;
    const expected = `form {
  data-x: 1; /* trailing */

  @view-transition (types: "save") {
    is-saved: "";
    @on reset {
      is-saved: none;
    }
  }
  /* block */
  @on submit (prevent-default) {
    @view-transition {
      #status {
        content: "saved";
      }
    }
  }
  @view-transition {
  }
}
`;
    expect(format(input)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  it("is idempotent and re-parses @on rules to the same events and options", () => {
    const input = `a{@on click , change ( handle : ( a , b(  $c , "d" ) ) ) ;@on  'evt' ( once , handle : x )}`;
    const once = format(input);
    expect(format(once)).toBe(once);
    const shape = (src: string) =>
      (parse(src).body[0] as any).block.body.map((n: any) => [
        n.name,
        n.events.map((e: any) => e.name),
        n.options.map((o: any) => o.name),
      ]);
    expect(shape(once)).toEqual(shape(input));
    expect(shape(once)).toEqual([
      ["on", ["click", "change"], ["handle"]],
      ["on", ["evt"], ["once", "handle"]],
    ]);
  });
});

describe("format: real-world sheets", () => {
  const viewsDir = resolve(__dirname, "../../../docs-site/public/views");
  const sheets = readdirSync(viewsDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".quark"));

  it("finds the docs-site sheets", () => {
    expect(sheets.length).toBeGreaterThanOrEqual(4);
  });

  it.each(sheets)("%s: formats, re-parses, and is idempotent", (sheet) => {
    const source = readFileSync(resolve(viewsDir, sheet), "utf8");
    const once = format(source);
    expect(() => parse(once)).not.toThrow();
    expect(format(once)).toBe(once);
  });
});

describe("format: idempotency on synthetic inputs", () => {
  const inputs = [
    `a{x:( $a or $b )and $c;}`,
    `#x{content:iterate($packageMeta.elementApis);[bind-tag]{content:item.tag;}}`,
    `a{/* one */x:1;/* two */}`,
    `@scope{a{x:1;}@on click{y:2;}}`,
  ];
  it.each(inputs)("format(format(x)) === format(x): %s", (input) => {
    const once = format(input);
    expect(format(once)).toBe(once);
  });
});

/** Formats once, asserts idempotency and re-parseability, returns the output. */
const fmt = (input: string, options?: Parameters<typeof format>[1]): string => {
  const once = format(input, options);
  expect(() => parse(once)).not.toThrow();
  expect(format(once, options)).toBe(once);
  return once;
};

/** Deep-clones an AST without `start` / `end` spans. */
const stripSpans = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(stripSpans);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      out[key] = stripSpans(value);
    }
    return out;
  }
  return node;
};

/** Formats and asserts the output parses to the same span-less AST. */
const roundTrips = (input: string): string => {
  const once = fmt(input);
  expect(stripSpans(parse(once))).toEqual(stripSpans(parse(input)));
  return once;
};

describe("format: blocks, options, and errors", () => {
  it("prints empty blocks", () => {
    expect(fmt("a{}")).toBe("a {\n}\n");
    expect(fmt("@scope{}")).toBe("@scope {\n}\n");
  });

  it("honours the indent option", () => {
    expect(fmt("a{b{c:1}}", { indent: "\t" })).toBe(
      "a {\n\tb {\n\t\tc: 1;\n\t}\n}\n"
    );
  });

  it("rethrows parse errors", () => {
    expect(() => format("a { b: ?; }")).toThrow(QuarkParseError);
    expect(() => format("a { b: c")).toThrow(/Unclosed block/);
  });

  it("surfaces the parser's rejection of non-Quark constructs unchanged", () => {
    for (const source of [
      "@media (x){a{b:c}}",
      "%ph{x:1}",
      "#{$sel}{x:1}",
      "a{x:1 !important}",
      "a{font: bold{family:serif}}",
      '@use "x" with ($a: 1);',
    ]) {
      const thrown = (() => {
        try {
          parse(source);
        } catch (error) {
          return error as Error;
        }
        throw new Error(`expected a parse error: ${source}`);
      })();
      expect(() => format(source)).toThrow(QuarkParseError);
      expect(() => format(source)).toThrow(thrown.message);
    }
  });
});

describe("format: comment placement", () => {
  it("keeps a trailing multi-line block comment verbatim", () => {
    expect(fmt("a {\n  x: 1; /* one\n  two */\n}")).toBe(
      `a {
  x: 1; /* one
  two */
}
`
    );
  });

  it("re-indents the interior lines of a leading block comment", () => {
    expect(fmt("a {\n      /* multi\n         line */\n  x: 1;\n}")).toBe(
      `a {
  /* multi
     line */
  x: 1;
}
`
    );
  });

  it("leaves interior lines that do not share the comment's indent", () => {
    expect(fmt("a {\n    /* one\ntwo */\n}")).toBe(
      `a {
  /* one
two */
}
`
    );
  });

  it("keeps blank lines after comments and comments after closing braces", () => {
    expect(fmt("/* a */\n\n\n\nb { x: 1; } /* done */\n\n\nc { y: 2; }")).toBe(
      `/* a */

b {
  x: 1;
} /* done */

c {
  y: 2;
}
`
    );
  });

  it("keeps a comment between selector groups and a trailing block comment", () => {
    expect(fmt("a{x:1}/* between */\nb{y:2;/* end */}")).toBe(
      `a {
  x: 1;
} /* between */
b {
  y: 2; /* end */
}
`
    );
  });
});

describe("format: structured at-rules", () => {
  it("prints @debug / @warn / @error", () => {
    expect(fmt('@debug "x";@warn $w;@error "boom";')).toBe(
      `@debug "x";
@warn $w;
@error "boom";
`
    );
  });

  it("prints @use namespaces", () => {
    expect(fmt('@use "/lib/math" as m;@use "/x" as *;@use "/y";')).toBe(
      `@use "/lib/math" as m;
@use "/x" as *;
@use "/y";
`
    );
  });

  it("prints @scope, empty and nested", () => {
    expect(fmt("@scope{}a{@scope{b{x:1}}}")).toBe(
      `@scope {
}
a {
  @scope {
    b {
      x: 1;
    }
  }
}
`
    );
  });

  it("normalizes single-quoted @on events to double quotes", () => {
    expect(fmt("a{@on 'evt' (handle: x);}")).toBe(
      `a {\n  @on "evt" (handle: x);\n}\n`
    );
  });
});

describe("format: selector parts", () => {
  it("prints attribute values, modifiers, pseudo arguments, and combinators", () => {
    expect(
      fmt(
        'a[b="v" i],[b=v],[b=5],li:nth-child( 2n+1 )::part( label ),a~b,a+b,>li,&-suffix,&:hover,:is(a,b),:host(.x),*{x:1}'
      )
    ).toBe(
      `a[b="v" i],
[b=v],
[b=5],
li:nth-child(2n+1)::part(label),
a ~ b,
a + b,
> li,
&-suffix,
&:hover,
:is(a, b),
:host(.x),
* {
  x: 1;
}
`
    );
  });
});

describe("format: 80-column wrapping", () => {
  it("keeps everything that fits on one line", () => {
    expect(
      fmt("a{x:fn(1,2);m:(k:1,v:2);c:if($a:1;else:2);b:$a and $b or $c}")
    ).toBe(
      `a {
  x: fn(1, 2);
  m: (k: 1, v: 2);
  c: if($a: 1; else: 2);
  b: $a and $b or $c;
}
`
    );
  });

  it("breaks an overflowing map one entry per line", () => {
    const input = `:scope { @on input { dataset: (trip: event.target.form.elements["data-trip"].value, outbound: event.target.form.elements["data-outbound"].value); } }`;
    expect(roundTrips(input)).toBe(
      `:scope {
  @on input {
    dataset: (
      trip: event.target.form.elements["data-trip"].value,
      outbound: event.target.form.elements["data-outbound"].value
    );
  }
}
`
    );
  });

  it("breaks overflowing call arguments and bracket lists one item per line", () => {
    expect(
      roundTrips(
        `a { x: sumLengths(item.cssClasses, item.cssProperties, item.cssAliases, item.parts)[1]; y: [aaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbb, cccccccccccccccccc, dddddddddddddddddd]; }`
      )
    ).toBe(
      `a {
  x: sumLengths(
    item.cssClasses,
    item.cssProperties,
    item.cssAliases,
    item.parts
  )[1];
  y: [
    aaaaaaaaaaaaaaaa,
    bbbbbbbbbbbbbbbbbb,
    cccccccccccccccccc,
    dddddddddddddddddd
  ];
}
`
    );
  });

  it("breaks if() arms one per line and hugs a value that fits after its key", () => {
    const input = `a { data-mode: if(event.target.name == "data-mode": event.target.value; else: preserve); }`;
    expect(roundTrips(input)).toBe(
      `a {
  data-mode: if(
    event.target.name == "data-mode": event.target.value;
    else: preserve
  );
}
`
    );
  });

  it("breaks after a pair's colon when even `key: value(` does not fit", () => {
    const input = `a { data-pickup-weekday: if(event.target.name == "data-pickup-date" and event.target.valueAsDate: event.target.valueAsDate.toLocaleDateString("en-US", (weekday: "short", timeZone: "UTC")); else: preserve); }`;
    expect(roundTrips(input)).toBe(
      `a {
  data-pickup-weekday: if(
    event.target.name == "data-pickup-date" and event.target.valueAsDate:
      event.target.valueAsDate.toLocaleDateString(
        "en-US",
        (weekday: "short", timeZone: "UTC")
      );
    else: preserve
  );
}
`
    );
  });

  it("wraps operator chains like text, breaking after an operator", () => {
    const input = `a { data-is-open: $is-expanded-by-user and $has-loaded-content or $is-forced-open and not $is-disabled; }`;
    expect(roundTrips(input)).toBe(
      `a {
  data-is-open: $is-expanded-by-user and $has-loaded-content or
    $is-forced-open and not $is-disabled;
}
`
    );
  });

  it("breaks a parenthesised sub-expression as its own group (prettier's SCSS shape)", () => {
    const input = `a { x: ($aaaaaaaaaaaaaaaaaaaaaaaa or $bbbbbbbbbbbbbbbbbbbbbbbbbb or $cccccccccccccccccccccccc) and $d; }`;
    // The paren group sits inside the wrapped chain, so its contents take
    // the chain's continuation indent plus their own, as in prettier.
    expect(roundTrips(input)).toBe(
      `a {
  x: (
      $aaaaaaaaaaaaaaaaaaaaaaaa or $bbbbbbbbbbbbbbbbbbbbbbbbbb or
      $cccccccccccccccccccccccc
    ) and
    $d;
}
`
    );
  });

  it("wraps space lists like text", () => {
    const input = `a { grid-template-areas: aaaaaaaaaaaaaaa bbbbbbbbbbbbbbb ccccccccccccccc ddddddddddddddd eeeeeeeeeee; }`;
    expect(roundTrips(input)).toBe(
      `a {
  grid-template-areas: aaaaaaaaaaaaaaa bbbbbbbbbbbbbbb ccccccccccccccc
    ddddddddddddddd eeeeeeeeeee;
}
`
    );
  });

  it("breaks a comma list of multi-word values one per line, like prettier's transition", () => {
    expect(
      roundTrips(
        `a { transition: opacity 0.3s ease, transform 0.3s ease; b: 1 + 2, 3; }`
      )
    ).toBe(
      `a {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
  b:
    1 + 2,
    3;
}
`
    );
  });

  it("wraps a comma list of single words like text, and exempts custom properties", () => {
    const input = `a { font-family: aaaaaaaaaaaaa, bbbbbbbbbbbbb, ccccccccccccc, ddddddddddddd, eeeeeeeeeeeee; --x: opacity 0.3s ease, transform 0.3s ease; }`;
    expect(roundTrips(input)).toBe(
      `a {
  font-family: aaaaaaaaaaaaa, bbbbbbbbbbbbb, ccccccccccccc, ddddddddddddd,
    eeeeeeeeeeeee;
  --x: opacity 0.3s ease, transform 0.3s ease;
}
`
    );
  });

  it("never breaks strings, selectors or interpolations", () => {
    const input = `a[data-x="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] { content: "You have booked a #{$booking["data-trip"]} flight #{if($booking["data-trip"] == "return": "from #{$booking["data-outbound"]}"; else: "on #{$booking["data-outbound"]}")}."; }`;
    const once = roundTrips(input);
    expect(once.split("\n")).toHaveLength(4);
  });

  it("breaks @on options and long heads of block at-rules", () => {
    const input = `a { @on click (target: "li[data-id]", once, debounce: 100 * 3, key: "Shift+K", host: window) { x: 1; } @delay $aaaaaaaaaaaaaaaaaaaaa * $bbbbbbbbbbbbbbbbbbbbbbb + $cccccccccccccccccccccccccc { y: 2; } }`;
    expect(roundTrips(input)).toBe(
      `a {
  @on click (
    target: "li[data-id]",
    once,
    debounce: 100 * 3,
    key: "Shift+K",
    host: window
  ) {
    x: 1;
  }
  @delay $aaaaaaaaaaaaaaaaaaaaa * $bbbbbbbbbbbbbbbbbbbbbbb +
    $cccccccccccccccccccccccccc {
    y: 2;
  }
}
`
    );
  });

  it("measures tab indentation as four columns", () => {
    const input = `a { b { c { x: fn(aaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbb, cccccccccccccccc, dddddddd); } } }`;
    expect(fmt(input, { indent: "\t" })).toBe(
      `a {
\tb {
\t\tc {
\t\t\tx: fn(
\t\t\t\taaaaaaaaaaaaaaaa,
\t\t\t\tbbbbbbbbbbbbbbbb,
\t\t\t\tcccccccccccccccc,
\t\t\t\tdddddddd
\t\t\t);
\t\t}
\t}
}
`
    );
    // The same call fits within 80 columns at two-space indentation.
    expect(fmt(input)).toContain(
      "x: fn(aaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbb, cccccccccccccccc, dddddddd);"
    );
  });

  it("keeps trailing comments after a wrapped declaration", () => {
    const input = `a { m: (trip: event.target.form.elements["data-trip"].value, outbound: event.target.form.elements["data-outbound"].value); /* note */ }`;
    expect(fmt(input)).toBe(
      `a {
  m: (
    trip: event.target.form.elements["data-trip"].value,
    outbound: event.target.form.elements["data-outbound"].value
  ); /* note */
}
`
    );
  });

  it("formats the flight-booker sheet's long lines", () => {
    const input = `:scope {
  data-is-bookable: if($outbound and ($trip == "one-way" or $inbound and $inbound >= $outbound): ""; else: none);
}`;
    expect(roundTrips(input)).toBe(
      `:scope {
  data-is-bookable: if(
    $outbound and ($trip == "one-way" or $inbound and $inbound >= $outbound):
      "";
    else: none
  );
}
`
    );
  });
});

describe("format: expression forms and paren re-insertion", () => {
  it("prints every literal and accessor form", () => {
    expect(
      roundTrips(
        'a{x:#fff;y:true;z:null;w:fn(&);v:#{$a};o:math.$pi;p:(1,2);g:-(1 2);f:$list[$i+1];e:prop("p").body.items[0].name;d:if($a>1:"big";$a>0:"small";else:"none");c:fn($x:1,$rest...);b:"a #{$b} c";a:url("q.png")}'
      )
    ).toBe(
      `a {
  x: #fff;
  y: true;
  z: null;
  w: fn(&);
  v: #{$a};
  o: math.$pi;
  p: (1, 2);
  g: -(1 2);
  f: $list[$i + 1];
  e: prop("p").body.items[0].name;
  d: if($a > 1: "big"; $a > 0: "small"; else: "none");
  c: fn($x: 1, $rest...);
  b: "a #{$b} c";
  a: url("q.png");
}
`
    );
  });

  it("re-inserts parens at every binding power", () => {
    expect(
      roundTrips(
        "a{a:($a and $b) or $c;b:($a or $b) and $c;c:not ($a and $b);d:not $a and $b;e:($a and $b)==$c;f:(not $a)==$b;g:($a==$b)<$c;h:$a==($b!=$c);i:($a<$b)+1;j:$a<($b>$c);k:($a+$b)*$c;l:1-(2-3);m:(1-2)-3;n:1/(2*3);o:(1*2)%3;p:-(1*2);q:-($a+1);r:($a+$b).x;s:(-$a).b;t:-$a.b;u:not $a;v:-$x;w:+$y;x:$a%2}"
      )
    ).toBe(
      `a {
  a: $a and $b or $c;
  b: ($a or $b) and $c;
  c: not ($a and $b);
  d: not $a and $b;
  e: ($a and $b) == $c;
  f: (not $a) == $b;
  g: ($a == $b) < $c;
  h: $a == ($b != $c);
  i: ($a < $b) + 1;
  j: $a < ($b > $c);
  k: ($a + $b) * $c;
  l: 1 - (2 - 3);
  m: 1 - 2 - 3;
  n: 1 / (2 * 3);
  o: 1 * 2 % 3;
  p: -(1 * 2);
  q: -($a + 1);
  r: ($a + $b).x;
  s: (-$a).b;
  t: -$a.b;
  u: not $a;
  v: -$x;
  w: +$y;
  x: $a % 2;
}
`
    );
  });
});
