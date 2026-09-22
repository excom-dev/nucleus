import {
  AUDIT_PREFIX,
  auditConflictingProps,
  auditDataAndAriaAttrs,
  auditDefinition,
  auditNonDashedAttrs,
} from "../../lib/audits";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const defined = (
  props: Array<{ prop: string; attr: string | false }>,
  tag = "x-host"
) => ({
  tag,
  props,
});

describe("definition audits", () => {
  it("warns once for every non-dashed attribute, naming the element", () => {
    const messages = auditNonDashedAttrs(
      defined([
        { prop: "labelText", attr: "label-text" },
        { prop: "source", attr: "source" },
        { prop: "trip", attr: "trip" },
        { prop: "hostEl", attr: false },
      ])
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(
      "It is recommended that custom attributes contain dashes"
    );
    expect(messages[0]).toContain("Element `x-host`");
    expect(messages[0]).toContain("[source], [trip]");
  });

  it("warns for data- and aria- prefixed attributes", () => {
    const messages = auditDataAndAriaAttrs(
      defined([
        { prop: "dataFoo", attr: "data-foo" },
        { prop: "ariaLabel", attr: "aria-label" },
        { prop: "isOpen", attr: "is-open" },
      ])
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("do not start with `data-` or `aria-`");
    expect(messages[0]).toContain("[data-foo], [aria-label]");
  });

  it("warns per prop name that already exists on the probe element", () => {
    const probe = { title: "", hidden: false };
    const messages = auditConflictingProps(
      defined([
        { prop: "title", attr: "data-title" },
        { prop: "hidden", attr: "is-hidden" },
        { prop: "labelText", attr: "label-text" },
      ]),
      probe
    );
    expect(messages).toEqual([
      'Neutron warning: Element `x-host` overrides existing property "title". Hope you know what you\'re doing!',
      'Neutron warning: Element `x-host` overrides existing property "hidden". Hope you know what you\'re doing!',
    ]);
  });

  it("probes a real <div> by default", () => {
    expect(
      auditConflictingProps(
        defined([{ prop: "innerHTML", attr: "inner-html" }])
      )
    ).toHaveLength(1);
    expect(
      auditConflictingProps(
        defined([{ prop: "labelText", attr: "label-text" }])
      )
    ).toEqual([]);
  });

  it("returns nothing for a clean definition", () => {
    const meta = defined([
      { prop: "labelText", attr: "label-text" },
      { prop: "hostEl", attr: false },
    ]);
    expect(auditDefinition(meta, {})).toEqual([]);
  });

  it("prefixes every message for the page console", () => {
    const messages = auditDefinition(
      defined([{ prop: "title", attr: "title" }], "bad-host"),
      { title: "" }
    );
    expect(messages).toHaveLength(2);
    for (const message of messages)
      expect(message.startsWith(`${AUDIT_PREFIX} `)).toBe(true);
    expect(messages[0]).toContain("Element `bad-host`");
  });

  it("tolerates malformed records", () => {
    expect(auditDefinition({}, {})).toEqual([]);
    expect(auditDefinition({ tag: 3, props: "nope" }, {})).toEqual([]);
    expect(
      auditDefinition(
        { props: [null, 1, { attr: "x" }, { prop: "source", attr: "source" }] },
        {}
      )
    ).toEqual([
      `${AUDIT_PREFIX} Neutron warning: It is recommended that custom attributes contain dashes to prevent clashes with current or future native attributes. Element \`(unknown)\` has configured these non-dashed attributes: [source].`,
    ]);
  });
});
