import { parse, QUARK_AT_RULES } from "../../index";
import type { QuarkAtRuleName } from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const first = (src: string): any => parse(src).body[0];

describe("at-rules", () => {
  it("parses @use with a namespace", () => {
    expect(first('@use "/api-client.js" as api;')).toMatchObject({
      type: "atrule",
      name: "use",
      url: "/api-client.js",
      namespace: "api",
    });
  });

  it("parses @use with a global namespace", () => {
    expect(first('@use "src/corners" as *;').namespace).toBe("*");
    expect(first('@use "src/corners";').namespace).toBeNull();
  });

  it("parses @debug, @warn, and @error", () => {
    expect(first('@debug "value: " + $v;').value.operator).toBe("+");
    expect(first("@warn $w;").name).toBe("warn");
    expect(first('@error "boom";').name).toBe("error");
  });

  it("parses @on with one or more events, options and a block", () => {
    const one = first('@on click (handle: save($draft)) { is-saved: ""; }');
    expect(one).toMatchObject({ type: "atrule", name: "on" });
    expect(one.events.map((e: any) => [e.name, e.quoted])).toEqual([
      ["click", false],
    ]);
    expect(one.options.map((o: any) => [o.name, o.value.type])).toEqual([
      ["handle", "function"],
    ]);
    expect(one.block.body).toHaveLength(1);
    const many = first(
      '@on input, change, "my:evt" (debounce: 300) { data-draft: event.target.value; }'
    );
    expect(many.events.map((e: any) => [e.name, e.quoted])).toEqual([
      ["input", false],
      ["change", false],
      ["my:evt", true],
    ]);
    expect(many.block.body.map((s: any) => s.type)).toEqual(["declaration"]);
    // a bare block needs no options
    const bare = first(
      "@on click { data-count: $n + 1; span { content: $n; } }"
    );
    expect(bare.options).toEqual([]);
    expect(bare.block.body.map((s: any) => s.type)).toEqual([
      "declaration",
      "rule",
    ]);
    // spans cover the whole statement including the closing brace
    const src = "form { @on submit, reset (prevent-default) { x: 1; } }";
    const nested = (parse(src).body[0] as any).block.body[0];
    expect(src.slice(nested.start, nested.end)).toBe(
      "@on submit, reset (prevent-default) { x: 1; }"
    );
    expect(src.slice(nested.events[1].start, nested.events[1].end)).toBe(
      "reset"
    );
  });

  it("parses the @on statement form: options without a block", () => {
    const stmt = first("@on submit (prevent-default);");
    expect(stmt.block).toBeNull();
    expect(stmt.options.map((o: any) => [o.name, o.value])).toEqual([
      ["prevent-default", null],
    ]);
    const handle = first(
      "@on click, submit (debounce: 200, handle: (track, saveDraft($draft)));"
    );
    expect(handle.events.map((e: any) => e.name)).toEqual(["click", "submit"]);
    expect(handle.options.map((o: any) => o.name)).toEqual([
      "debounce",
      "handle",
    ]);
    expect(handle.options[1].value.type).toBe("list");
    expect(handle.options[1].value.parens).toBe(true);
    expect(handle.options[1].value.items).toHaveLength(2);
    // the `;` is optional before `}`; spans stop at the group
    const src = "form { @on submit (prevent-default) }";
    const nested = (parse(src).body[0] as any).block.body[0];
    expect(src.slice(nested.start, nested.end)).toBe(
      "@on submit (prevent-default)"
    );
  });

  it("parses @on options: flags, keyed values, expression values", () => {
    const flags = first(
      "@on click (once, self, passive, capture, prevent-default, stop-propagation, stop-immediate-propagation) { x: 1; }"
    );
    expect(flags.options.map((o: any) => [o.name, o.value])).toEqual([
      ["once", null],
      ["self", null],
      ["passive", null],
      ["capture", null],
      ["prevent-default", null],
      ["stop-propagation", null],
      ["stop-immediate-propagation", null],
    ]);
    const keyed = first(
      '@on keydown (key: "Shift+K", target: "li[data-id]", debounce: 300, host: window, handle: a) { x: 1; }'
    );
    expect(keyed.options.map((o: any) => [o.name, o.value.type])).toEqual([
      ["key", "string"],
      ["target", "string"],
      ["debounce", "number"],
      ["host", "identifier"],
      ["handle", "identifier"],
    ]);
    expect(keyed.options[3].value.name).toBe("window");
    // values may be expressions
    const block = first(
      '@on click (target: $row-selector, throttle: 100 * 2) { is-open: ""; }'
    );
    expect(block.options.map((o: any) => o.value.type)).toEqual([
      "variable",
      "binary",
    ]);
    // option spans
    const src = 'ul { @on click (target: "li", handle: pick); }';
    const nested = (parse(src).body[0] as any).block.body[0];
    expect(src.slice(nested.options[0].start, nested.options[0].end)).toBe(
      'target: "li"'
    );
    expect(src.slice(nested.start, nested.end)).toBe(
      '@on click (target: "li", handle: pick);'
    );
  });

  it("rejects malformed @on options", () => {
    expect(() => parse("@on click (once once) { }")).toThrow(/"," or "\)"/);
    expect(() => parse("@on click (once, once) { }")).toThrow(/Duplicate/);
    expect(() => parse("@on click (key:) { }")).toThrow(/value after/);
    expect(() => parse('@on click ("x") { }')).toThrow(/option name/);
    expect(() => parse("@on click (once { }")).toThrow();
  });

  it("rejects @on without events or anything to do, the removed handler list, and @off", () => {
    expect(() => parse("@on;")).toThrow(/event name/);
    expect(() => parse("@on click,;")).toThrow(/after ","/);
    expect(() => parse("@on click;")).toThrow(/nothing to do/);
    expect(() => parse("@on click ();")).toThrow(/nothing to do/);
    expect(() => parse("@on click prevent-default;")).toThrow(/handle:/);
    expect(() => parse("@on click (once) go;")).toThrow(/handle:/);
    expect(() => parse("@on click a, b { x: 1; }")).toThrow(/handle:/);
    expect(() => parse("@off click a;")).toThrow(/@off is not supported/);
    expect(() => parse("form { @off submit save; }")).toThrow(
      /@off is not supported/
    );
  });

  it("parses @dispatch and @command statements", () => {
    const d = first(
      '@dispatch cart-add (detail: (sku: $sku), target: "cart-view", bubbles: false);'
    );
    expect(d).toMatchObject({ type: "atrule", name: "dispatch" });
    expect(d.names.map((n: any) => [n.name, n.quoted])).toEqual([
      ["cart-add", false],
    ]);
    expect(
      d.options.map((o: any) => [o.name, o.value?.type ?? null])
    ).toEqual([
      ["detail", "map"],
      ["target", "string"],
      ["bubbles", "boolean"],
    ]);
    const many = first('@dispatch a, "b:c";');
    expect(many.names.map((n: any) => n.name)).toEqual(["a", "b:c"]);
    expect(many.options).toEqual([]);
    const c = first('@command --refresh, show-modal (target: "#feed");');
    expect(c).toMatchObject({ type: "atrule", name: "command" });
    expect(c.names.map((n: any) => n.name)).toEqual(["--refresh", "show-modal"]);
    // nested in an @on block; `;` optional before `}`; spans
    const src = 'button { @on click { @dispatch ping (target: "#out") } }';
    const on = (parse(src).body[0] as any).block.body[0];
    const action = on.block.body[0];
    expect(action.name).toBe("dispatch");
    expect(src.slice(action.start, action.end)).toBe(
      '@dispatch ping (target: "#out")'
    );
  });

  it("rejects malformed @dispatch / @command", () => {
    expect(() => parse("@dispatch;")).toThrow(/event name/);
    expect(() => parse("@dispatch ping { }")).toThrow(/statement/);
    expect(() => parse("@command --x go;")).toThrow(/"\(" or ";"/);
    expect(() => parse("@dispatch a (detail: 1, detail: 2);")).toThrow(
      /Duplicate/
    );
  });

  it("parses @view-transition blocks with and without options", () => {
    const bare = first(
      "@view-transition { data-count: $n + 1; ul { content: $n; } }"
    );
    expect(bare).toMatchObject({
      type: "atrule",
      name: "view-transition",
      options: [],
    });
    expect(bare.block.type).toBe("block");
    expect(bare.block.body.map((s: any) => s.type)).toEqual([
      "declaration",
      "rule",
    ]);
    const opts = first(
      '@view-transition (types: "a b", timeout: 1500, delay: 200, first-render, if-active: replace, until: "[is-x]") { x: 1; }'
    );
    expect(
      opts.options.map((o: any) => [o.name, o.value?.type ?? null])
    ).toEqual([
      ["types", "string"],
      ["timeout", "number"],
      ["delay", "number"],
      ["first-render", null],
      ["if-active", "identifier"],
      ["until", "string"],
    ]);
    // values are expressions: lists, calls, interpolated strings
    const exprs = first(
      '@view-transition (types: ("a", "b"), until: prop("load"), types-extra: "todo-#{$op}") { x: 1; }'
    );
    expect(exprs.options.map((o: any) => o.value.type)).toEqual([
      "list",
      "function",
      "string",
    ]);
    expect(first("@view-transition () { x: 1; }").options).toEqual([]);
  });

  it("parses @view-transition inside rules, @on blocks, @scope and another @view-transition", () => {
    const src =
      'ul { @view-transition (types: "t") { content: $n; li { x: 1; } } }';
    const nested = (parse(src).body[0] as any).block.body[0];
    expect(nested.name).toBe("view-transition");
    expect(src.slice(nested.start, nested.end)).toBe(
      '@view-transition (types: "t") { content: $n; li { x: 1; } }'
    );
    expect(src.slice(nested.options[0].start, nested.options[0].end)).toBe(
      'types: "t"'
    );
    const inOn = (
      parse('form { @on submit { @view-transition { is-saved: ""; } } }')
        .body[0] as any
    ).block.body[0].block.body[0];
    expect(inOn.name).toBe("view-transition");
    const inScope = (
      parse("@scope { @view-transition { ul { x: 1; } } }").body[0] as any
    ).block.body[0];
    expect(inScope.name).toBe("view-transition");
    const inner = first(
      '@view-transition { @view-transition (types: "in") { x: 1; } }'
    ).block.body[0];
    expect(inner).toMatchObject({ name: "view-transition" });
    expect(inner.options[0].name).toBe("types");
    expect(
      first("@view-transition { @on click { x: 1; } }").block.body[0].name
    ).toBe("on");
  });

  it("rejects @view-transition without a block and malformed options", () => {
    expect(() => parse("@view-transition;")).toThrow(/needs a block/);
    expect(() => parse('ul { @view-transition (types: "a"); }')).toThrow(
      /needs a block/
    );
    expect(() => parse("@view-transition (types types) { x: 1; }")).toThrow(
      /"," or "\)" in @view-transition/
    );
    expect(() =>
      parse('@view-transition (types: "a", types: "b") { x: 1; }')
    ).toThrow(/Duplicate @view-transition option "types"/);
    expect(() => parse("@view-transition (timeout:) { x: 1; }")).toThrow(
      /value after @view-transition option "timeout:"/
    );
    expect(() => parse('@view-transition ("x") { x: 1; }')).toThrow(
      /option name inside @view-transition/
    );
    expect(() => parse("@view-transition (types: 1 { x: 1; }")).toThrow();
    expect(() => parse("@view-transition { x: 1;")).toThrow(/Unclosed block/);
  });

  it("parses @delay blocks: one duration expression, then a block", () => {
    const literal = first(
      "@delay 2000 { data-copied: none; span { content: none; } }"
    );
    expect(literal).toMatchObject({ type: "atrule", name: "delay" });
    expect(literal.duration).toMatchObject({ type: "number", value: 2000 });
    expect(literal.block.body.map((s: any) => s.type)).toEqual([
      "declaration",
      "rule",
    ]);
    // the duration is any expression: bindings, calls, arithmetic, `or` fallbacks
    expect(first("@delay $ms * 2 { x: 1; }").duration.type).toBe("binary");
    expect(
      first('@delay +attr("data-ms") or 1500 { x: 1; }').duration.type
    ).toBe("binary");
    expect(
      first("@delay math.clamp(100, $ms, 5000) { x: 1; }").duration.type
    ).toBe("function");
    // spans cover the whole at-rule
    const src =
      'button { @on click { data-copied: ""; @delay 2000 { data-copied: none; } } }';
    const on = (parse(src).body[0] as any).block.body[0];
    const delay = on.block.body[1];
    expect(delay.name).toBe("delay");
    expect(src.slice(delay.start, delay.end)).toBe(
      "@delay 2000 { data-copied: none; }"
    );
    // nests: inside rules, @on blocks, @view-transition and another @delay
    const nested = first(
      "@delay 100 { @delay 200 { x: 1; } @view-transition { y: 2; } }"
    );
    expect(nested.block.body.map((s: any) => s.name)).toEqual([
      "delay",
      "view-transition",
    ]);
    expect(
      first("@scope { @delay 5 { a { x: 1; } } }").block.body[0].name
    ).toBe("delay");
  });

  it("rejects @delay without a duration or a block", () => {
    expect(() => parse("@delay { x: 1; }")).toThrow(/duration after @delay/);
    expect(() => parse("@delay;")).toThrow(/duration after @delay/);
    expect(() => parse("@delay 2000;")).toThrow(/needs a block/);
    expect(() => parse("@delay 2000 x: 1;")).toThrow(/needs a block/);
    expect(() => parse("@delay 2000 { x: 1;")).toThrow(/Unclosed block/);
  });

  it("parses @warn / @debug / @error inside rules and blocks with any expression", () => {
    const src =
      'img:not([alt]) { @warn "img needs alt"; @on load { @debug "size", event.target.naturalWidth; } }';
    const rule = parse(src).body[0] as any;
    const warn = rule.block.body[0];
    expect(warn).toMatchObject({ type: "atrule", name: "warn" });
    expect(warn.value).toMatchObject({
      type: "string",
      value: "img needs alt",
    });
    expect(src.slice(warn.start, warn.end)).toBe('@warn "img needs alt";');
    const debug = rule.block.body[1].block.body[0];
    expect(debug.name).toBe("debug");
    expect(debug.value.type).toBe("list");
    expect(debug.value.items.map((i: any) => i.type)).toEqual([
      "string",
      "member",
    ]);
    expect(first("@error $msg;").name).toBe("error");
  });

  it("parses @scope blocks and rejects a prelude", () => {
    const r = first("@scope { a { b: c; } }");
    expect(r).toMatchObject({ type: "atrule", name: "scope" });
    expect(r.block.body[0].type).toBe("rule");
    expect(() => parse("@scope (.card) to (.inner) { a { b: c; } }")).toThrow(
      /@scope does not take a prelude.*\(1:8\)/
    );
  });

  it("parses every Quark at-rule", () => {
    const minimal: Record<QuarkAtRuleName, string> = {
      use: '@use "/x.js";',
      scope: "@scope { a { b: c; } }",
      on: "a { @on click { b: c; } }",
      dispatch: "a { @on click { @dispatch ping; } }",
      command: "a { @on click { @command --refresh; } }",
      "view-transition": "@view-transition { a { b: c; } }",
      delay: "a { @delay 1 { b: c; } }",
      warn: '@warn "x";',
      debug: "@debug $x;",
      error: '@error "x";',
    };
    for (const name of QUARK_AT_RULES) {
      expect(() => parse(minimal[name])).not.toThrow();
    }
  });

  it("rejects every at-rule that is not Quark's own", () => {
    const rejected = [
      // plain CSS
      "media",
      "supports",
      "keyframes",
      "font-face",
      "charset",
      "page",
      "layer",
      // SCSS
      "if",
      "else",
      "each",
      "for",
      "while",
      "mixin",
      "include",
      "content",
      "function",
      "return",
      "forward",
      "import",
      "extend",
      "at-root",
      // unknown
      "nope",
    ];
    for (const name of rejected) {
      expect(() => parse(`@${name} x { a: b; }`)).toThrow(
        new RegExp(`@${name} is not a Quark at-rule \\(1:1\\)`)
      );
      expect(() => parse(`a { @${name} x { b: c; } }`)).toThrow(
        /is not a Quark at-rule \(1:5\)/
      );
    }
  });

  it("rejects a @use with clause", () => {
    expect(() => parse('@use "x" with ($a: 1);')).toThrow(
      /@use does not take a with clause \(1:10\)/
    );
  });
});
