import { Neutron } from "../../src/neutron";
import { describe, expect, fixture, it } from "@excom/nucleus-test";

let count = 0;
const uniqueTag = () => `compose-el-${++count}`;

/** Each option as a builder states it, and as the built config holds it. */
const OPTIONS = {
  renderRoot: [
    { tag: "section" },
    { tag: "section", shadow: undefined, defaultSlots: false },
  ],
  reflectDefaultProps: [["isMounted"], ["isMounted"]],
  ssr: [false, false],
  definitionOpts: [{ extends: "p" }, { extends: "p" }],
} as const;

const builder = (options: object = {}) =>
  Neutron({ tag: uniqueTag(), props: {}, ...options });

describe("Neutron.compose: options", () => {
  it.each(Object.keys(OPTIONS))(
    "%s: a builder that omits it, or leaves it undefined, inherits it",
    (name) => {
      const [stated, built] = OPTIONS[name as keyof typeof OPTIONS];
      const base = () => builder({ [name]: stated });
      const unset = () => builder({ [name]: undefined });
      [
        [base(), builder()],
        [base(), builder(), builder()],
        [base(), unset()],
        [base(), unset(), builder()],
      ].forEach((builders) =>
        expect(Neutron.compose(builders).builtConfig[name]).toEqual(built)
      );
    }
  );

  it("both stated: the later replaces, unmerged", () => {
    const { builtConfig } = Neutron.compose([
      builder({
        renderRoot: { tag: "section", shadow: "open" },
        reflectDefaultProps: ["isMounted"],
        ssr: false,
        definitionOpts: { extends: "p" },
      }),
      builder({
        renderRoot: { tag: "main" },
        reflectDefaultProps: ["wasMounted"],
        ssr: true,
        definitionOpts: {},
      }),
    ]);
    expect(builtConfig.renderRoot).toEqual({
      tag: "main",
      shadow: undefined,
      defaultSlots: false,
    });
    expect(builtConfig.reflectDefaultProps).toEqual(["wasMounted"]);
    expect(builtConfig.ssr).toBe(true);
    expect(builtConfig.definitionOpts).toEqual({});
  });

  it("none stated: the built config holds none", () => {
    const { builtConfig } = Neutron.compose([builder(), builder()]);
    expect(
      ["renderRoot", "reflectDefaultProps", "ssr", "definitionOpts"].filter(
        (name) => name in builtConfig
      )
    ).toEqual([]);
  });

  it("an element composed from a base with renderRoot and reflectDefaultProps renders into that root and reflects", () => {
    const tag = uniqueTag();
    Neutron.compose([
      builder({ renderRoot: { tag: "section" }, reflectDefaultProps: ["isMounted"] }),
      Neutron({ tag, props: {} }),
    ]).define();
    const el = fixture<any>(`<${tag}></${tag}>`);
    expect(el.renderRoot).toBe(el.querySelector(":scope > section"));
    expect(el.hasAttribute("is-mounted")).toBe(true);
  });
});
