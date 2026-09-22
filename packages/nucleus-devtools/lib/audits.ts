/**
 * Definition audits: pure checks over a `neutron/defined` record's
 * `{ tag, props }`. They reproduce the `?nq-debug` warnings that used to
 * ship inside `@excom/neutron` / `@excom/kit-devtools`; the
 * MAIN-world page hook runs them for every definition and `console.warn`s
 * each message in the page console.
 */

export const AUDIT_PREFIX = "[nucleus-devtools]";

/** One `{ prop, attr }` pair from a `neutron/defined` record. */
export type DefinedProp = { prop: string; attr: string | false | null };

export type DefinedMeta = { tag?: unknown; props?: unknown };

type Probe = Record<string, unknown>;

const readProps = (meta: DefinedMeta): DefinedProp[] =>
  Array.isArray(meta.props)
    ? meta.props.filter(
        (p): p is DefinedProp =>
          !!p &&
          typeof p === "object" &&
          typeof (p as DefinedProp).prop === "string"
      )
    : [];

const readTag = (meta: DefinedMeta): string =>
  typeof meta.tag === "string" ? meta.tag : "(unknown)";

const attrsOf = (props: DefinedProp[], keep: (attr: string) => boolean) =>
  props
    .map((p) => p.attr)
    .filter(
      (attr): attr is string =>
        typeof attr === "string" && attr !== "" && keep(attr)
    );

const list = (attrs: string[]) => attrs.map((a) => `[${a}]`).join(", ");

/** Custom attributes should contain a dash so they can never shadow a native one. */
export const auditNonDashedAttrs = (meta: DefinedMeta): string[] => {
  const attrs = attrsOf(readProps(meta), (attr) => !attr.includes("-"));
  return attrs.length
    ? [
        `Neutron warning: It is recommended that custom attributes contain dashes to prevent clashes with current or future native attributes. Element \`${readTag(meta)}\` has configured these non-dashed attributes: ${list(attrs)}.`,
      ]
    : [];
};

/** `data-` / `aria-` attributes carry native getter / setter / serialization semantics. */
export const auditDataAndAriaAttrs = (meta: DefinedMeta): string[] => {
  const attrs = attrsOf(
    readProps(meta),
    (attr) => attr.startsWith("data-") || attr.startsWith("aria-")
  );
  return attrs.length
    ? [
        `Neutron warning: It is recommended that custom attributes do not start with \`data-\` or \`aria-\` to prevent unexpected behavior on those attributes getters/setters/serialization. Element \`${readTag(meta)}\` has configured these attributes: ${list(attrs)}.`,
      ]
    : [];
};

/**
 * A prop that already exists on `HTMLElement` overrides the native member
 * (`name in document.createElement("div")`). The probe element is
 * injectable for tests.
 */
export const auditConflictingProps = (
  meta: DefinedMeta,
  probe: Probe = document.createElement("div") as unknown as Probe
): string[] =>
  readProps(meta)
    .filter(({ prop }) => prop in probe)
    .map(
      ({ prop }) =>
        `Neutron warning: Element \`${readTag(meta)}\` overrides existing property "${prop}". Hope you know what you're doing!`
    );

/** Every audit, prefixed for the page console. */
export const auditDefinition = (meta: DefinedMeta, probe?: Probe): string[] =>
  [
    ...auditNonDashedAttrs(meta),
    ...auditDataAndAriaAttrs(meta),
    ...auditConflictingProps(meta, probe),
  ].map((message) => `${AUDIT_PREFIX} ${message}`);
