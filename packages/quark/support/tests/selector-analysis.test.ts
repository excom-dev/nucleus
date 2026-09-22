/**
 * `analyzeSelector` classifies what a selector depends on and where the
 * subjects sit relative to each change (see `CompoundDependency`). These
 * are the build-time facts `Rule._run` dispatches on; the DOM behaviour
 * they drive is covered in `selectors.test.ts`.
 */
import { PSEUDO_CLASSES } from "../../src/language";
import { analyzeSelector } from "../../src/selector-utils";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const sorted = (set: Set<string>) => [...set].sort();

describe("analyzeSelector", () => {
  it("buckets plain attribute gates on their own compound", () => {
    const { path, attrs, compounds, reactsToRemovals, unobserved } =
      analyzeSelector("section[data-on] > li[data-x]");
    expect(path).toEqual(["section[data-on]", ">", "li[data-x]"]);
    expect(sorted(attrs)).toEqual(["data-on", "data-x"]);
    expect(compounds).toHaveLength(2);
    expect(compounds[0]).toMatchObject({
      pathIndex: 0,
      prefix: "section[data-on]",
      prefixNeedsScope: false,
      isSubject: false,
      root: "self",
    });
    expect(sorted(compounds[0].selfAttrs)).toEqual(["data-on"]);
    expect(compounds[1]).toMatchObject({
      pathIndex: 2,
      prefix: "section[data-on] > li[data-x]",
      isSubject: true,
    });
    expect(sorted(compounds[1].selfAttrs)).toEqual(["data-x"]);
    expect(reactsToRemovals).toBe(false);
    expect(unobserved).toEqual([]);
  });

  it("scopes only a prefix that starts with a combinator", () => {
    expect(analyzeSelector("> span").compounds[0].prefixNeedsScope).toBe(true);
    expect(analyzeSelector("+ span").compounds[0].prefixNeedsScope).toBe(true);
    expect(analyzeSelector("span").compounds[0].prefixNeedsScope).toBe(false);
  });

  it("ignores blacklisted attribute names", () => {
    const { attrs } = analyzeSelector(
      "[q-scope] [n-x] [style] [content] [data-ok]"
    );
    expect(sorted(attrs)).toEqual(["data-ok"]);
  });

  describe("class and id selectors", () => {
    it("gates on class / id like attributes and collects the class tokens", () => {
      const { attrs, compounds, classNames } = analyzeSelector(
        "section.card[data-on] > li.item#main"
      );
      expect(sorted(attrs)).toEqual(["class", "data-on", "id"]);
      expect(sorted(compounds[0].selfAttrs)).toEqual(["class", "data-on"]);
      expect(sorted(compounds[1].selfAttrs)).toEqual(["class", "id"]);
      expect(sorted(classNames!)).toEqual(["card", "item"]);
    });

    it("follows classes into arguments", () => {
      const { compounds, classNames } = analyzeSelector(
        "ul:has(li.is-active) li:not(.is-done):is(section.is-open *)"
      );
      expect(sorted(compounds[0].hasAttrs)).toEqual(["class"]);
      expect(sorted(compounds[1].selfAttrs)).toEqual(["class"]);
      expect(sorted(compounds[1].looseAttrs)).toEqual(["class"]);
      expect(sorted(classNames!)).toEqual(["is-active", "is-done", "is-open"]);
    });

    it("drops the class filter when the whole class value matters", () => {
      expect(analyzeSelector('li[class~="is-done"]').classNames).toBeNull();
      expect(analyzeSelector("li.done:not([class])").classNames).toBeNull();
      expect(analyzeSelector("li.sm\\:hidden").classNames).toBeNull();
      expect(analyzeSelector("li[data-x]").classNames).toEqual(new Set());
    });
  });

  describe("logical pseudo-classes", () => {
    it("treats simple :is() / :where() / :not() arguments as the compound's own", () => {
      const { compounds, attrs } = analyzeSelector(
        "li:is([data-a], [data-b]):where([data-c]):not([data-d])"
      );
      expect(sorted(attrs)).toEqual(["data-a", "data-b", "data-c", "data-d"]);
      expect(sorted(compounds[0].selfAttrs)).toEqual([
        "data-a",
        "data-b",
        "data-c",
        "data-d",
      ]);
      expect(compounds[0].looseAttrs.size).toBe(0);
    });

    it("puts the earlier compounds of a complex argument in the loose bucket", () => {
      const [c] = analyzeSelector(
        ":is(section[data-on] li[data-x], [data-y])"
      ).compounds;
      expect(sorted(c.selfAttrs)).toEqual(["data-x", "data-y"]);
      expect(sorted(c.looseAttrs)).toEqual(["data-on"]);
      expect(c.looseRoot).toBe("self");
    });

    it("fans loose changes out from the parent when an argument uses a sibling combinator", () => {
      const { compounds, positional, reactsToRemovals } = analyzeSelector(
        "b:is(a[data-x] ~ b)"
      );
      expect(sorted(compounds[0].looseAttrs)).toEqual(["data-x"]);
      expect(compounds[0].siblingInArgs).toBe(true);
      expect(compounds[0].looseRoot).toBe("parent");
      expect(positional).toBe(true);
      expect(reactsToRemovals).toBe(true);
    });
  });

  describe("sibling combinators", () => {
    it("roots the compound before + / ~ at the parent", () => {
      const { compounds, positional, reactsToRemovals } = analyzeSelector(
        "a[data-x] ~ b[data-y] + c > d"
      );
      expect(compounds.map((c) => c.root)).toEqual([
        "parent",
        "parent",
        "self",
        "self",
      ]);
      expect(sorted(compounds[0].selfAttrs)).toEqual(["data-x"]);
      expect(sorted(compounds[1].selfAttrs)).toEqual(["data-y"]);
      expect(compounds[3].isSubject).toBe(true);
      expect(positional).toBe(true);
      expect(reactsToRemovals).toBe(true);
    });
  });

  describe(":has()", () => {
    it("puts descendant-relative argument attributes in the has bucket", () => {
      const { compounds, usesHas, reactsToRemovals } = analyzeSelector(
        "div:not([data-a]) > [data-b]:has([q-x], [data-c])"
      );
      const [ancestor, subject] = compounds;
      expect(sorted(ancestor.selfAttrs)).toEqual(["data-a"]);
      expect(ancestor.reactsToChildren).toBe(false);
      expect(sorted(subject.selfAttrs)).toEqual(["data-b"]);
      expect(sorted(subject.hasAttrs)).toEqual(["data-c"]);
      expect(subject.reactsToChildren).toBe(true);
      expect(subject.broad).toBe(false);
      expect(usesHas).toBe(true);
      expect(reactsToRemovals).toBe(true);
    });

    it("keeps :has() in an ancestor compound rooted there", () => {
      const { compounds } = analyzeSelector("section:has([data-open]) button");
      expect(sorted(compounds[0].hasAttrs)).toEqual(["data-open"]);
      expect(compounds[0].isSubject).toBe(false);
      expect(compounds[0].root).toBe("self");
      expect(compounds[1].hasAttrs.size).toBe(0);
    });

    it("marks sibling-relative arguments broad", () => {
      const [c] = analyzeSelector("label:has(+ input[data-invalid])").compounds;
      expect(sorted(c.broadAttrs)).toEqual(["data-invalid"]);
      expect(c.hasAttrs.size).toBe(0);
      expect(c.broad).toBe(true);
      expect(c.reactsToChildren).toBe(true);
    });

    it("marks the earlier compounds of a complex :has() argument broad", () => {
      const [c] = analyzeSelector(
        "div:has(section[data-s] [data-x])"
      ).compounds;
      expect(sorted(c.hasAttrs)).toEqual(["data-x"]);
      expect(sorted(c.broadAttrs)).toEqual(["data-s"]);
      expect(c.broad).toBe(false);
    });

    it("keeps :not(:has()) in the has bucket but a :has() inside a complex :is() arm broad", () => {
      const [negated] = analyzeSelector("ul:not(:has([data-x]))").compounds;
      expect(sorted(negated.hasAttrs)).toEqual(["data-x"]);
      expect(negated.broad).toBe(false);
      const [nested] = analyzeSelector(
        "p:is(section:has([data-x]) p)"
      ).compounds;
      expect(sorted(nested.broadAttrs)).toEqual(["data-x"]);
      expect(nested.broad).toBe(true);
    });
  });

  describe("structural pseudo-classes", () => {
    it("flags sibling position and removals", () => {
      for (const pseudo of [
        ":first-child",
        ":last-child",
        ":only-child",
        ":nth-child(2n+1)",
        ":nth-last-child(2)",
        ":first-of-type",
        ":last-of-type",
        ":only-of-type",
        ":nth-of-type(3)",
        ":nth-last-of-type(odd)",
      ]) {
        const { compounds, positional, reactsToRemovals, usesHas } =
          analyzeSelector(`li${pseudo}`);
        expect(compounds[0].positional, pseudo).toBe(true);
        expect(positional, pseudo).toBe(true);
        expect(reactsToRemovals, pseudo).toBe(true);
        expect(usesHas, pseudo).toBe(false);
      }
    });

    it("observes the selector of `of S` on the siblings", () => {
      const [c] = analyzeSelector(
        "li:nth-child(1 of [data-visible]:not([data-x]))"
      ).compounds;
      expect(sorted(c.looseAttrs)).toEqual(["data-visible", "data-x"]);
      expect(c.looseRoot).toBe("parent");
      expect(c.positional).toBe(true);
    });

    it("re-checks :empty on child changes", () => {
      const { compounds, usesHas, reactsToRemovals } =
        analyzeSelector("ul:empty");
      expect(compounds[0].reactsToChildren).toBe(true);
      expect(usesHas).toBe(true);
      expect(reactsToRemovals).toBe(true);
    });
  });

  describe("attribute-backed pseudo-classes", () => {
    it("observes the backing attribute on the element and above it", () => {
      const cases: Record<string, string[]> = {
        ":disabled": ["disabled"],
        ":enabled": ["disabled"],
        ":required": ["required"],
        ":optional": ["required"],
        ":read-only": ["contenteditable", "disabled", "readonly"],
        ":read-write": ["contenteditable", "disabled", "readonly"],
        ":any-link": ["href"],
        ":lang(en)": ["lang"],
        ":open": ["open"],
      };
      for (const [pseudo, names] of Object.entries(cases)) {
        const { compounds, attrs, unobserved } = analyzeSelector(`*${pseudo}`);
        expect(sorted(attrs), pseudo).toEqual(names);
        expect(sorted(compounds[0].selfAttrs), pseudo).toEqual(names);
        expect(sorted(compounds[0].looseAttrs), pseudo).toEqual(names);
        expect(unobserved, pseudo).toEqual([]);
      }
    });

    it("keeps an attribute pseudo-class inside :has() in the has bucket", () => {
      const [c] = analyzeSelector("form:has(input:required)").compounds;
      expect(sorted(c.hasAttrs)).toEqual(["required"]);
      expect(c.looseAttrs.size).toBe(0);
    });
  });

  describe("unobserved selectors", () => {
    it("reports interaction pseudo-classes, pseudo-elements and unknown names", () => {
      expect(analyzeSelector("a:hover::before").unobserved).toEqual([
        ":hover",
        "::before",
      ]);
      expect(analyzeSelector("input:checked").unobserved).toEqual([":checked"]);
      expect(analyzeSelector("x:made-up").unobserved).toEqual([":made-up"]);
      expect(analyzeSelector(":scope:root").unobserved).toEqual([]);
    });

    it("documents every unobserved pseudo-class it warns for", () => {
      for (const doc of PSEUDO_CLASSES.filter((d) => d.kind === "unobserved")) {
        expect(analyzeSelector(`a:${doc.name}`).unobserved).toEqual([
          `:${doc.name}`,
        ]);
      }
    });
  });
});
