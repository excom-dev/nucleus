/**
 * Form-control sync. Native `<input>`, `<option>`, and `<textarea>`
 * markup is only the *default* (`value` / `checked` / `selected`, or
 * textarea text). After the user edits (spec "dirty" flags), the live
 * `.value` / `.checked` / `.selected` stop following those attrs, so a
 * rule write would silently not show.
 *
 * The attribute stays the serializable source of truth. After a rule
 * write, we push the same state onto the live property. Compare against
 * the *live* value, not the attr, so a re-run that resolves to the
 * current attr still restores a control the user has edited away.
 *
 * Custom elements are left alone (they own reflection). `<select>` has
 * no `value` attr; write `selected` on its options.
 */

/** Attribute keys synced to a live property, per native tag. */
export const FORM_CONTROL_ATTRIBUTES: Readonly<
  Record<string, readonly string[]>
> = {
  input: ["value", "checked"],
  option: ["selected"],
};

/** Tags whose text is a default value mirrored to `.value`. */
export const TEXT_CONTROL_TAGS: readonly string[] = ["textarea"];

/** `true` when Quark syncs `name` on `element` (documented table above). */
export const isFormControlAttribute = (element: Element, name: string) =>
  !!FORM_CONTROL_ATTRIBUTES[element.localName]?.includes(name);

/**
 * After an attr write (`value` = the string, `null` = removed), push the
 * same state onto the live property when it differs.
 */
export const syncFormControlAttribute = (
  element: Element,
  name: string,
  value: string | null
) => {
  if (!isFormControlAttribute(element, name)) return;
  if (name === "value") {
    const input = element as HTMLInputElement;
    // a file input's value is read-only (assigning anything but "" throws)
    if (input.type === "file") return;
    const next = value ?? "";
    if (input.value !== next) input.value = next;
    return;
  }
  // `checked` / `selected`: presence attributes
  const present = value !== null;
  const control = element as HTMLInputElement & HTMLOptionElement;
  if (control[name] !== present) control[name] = present;
};

/**
 * After a text paint / wipe into a text control, mirror the new default
 * onto `.value` when the live value has drifted.
 */
export const syncTextControl = (target: Node, text: string) => {
  if (
    target.nodeType !== Node.ELEMENT_NODE ||
    !TEXT_CONTROL_TAGS.includes((target as Element).localName)
  ) {
    return;
  }
  const control = target as HTMLTextAreaElement;
  if (control.value !== text) control.value = text;
};
