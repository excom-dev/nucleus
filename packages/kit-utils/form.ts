import { isNumber } from "./common";
import * as pathval from "pathval";

export function parseFormInputValue(
  root,
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined,
  key,
  value
) {
  if (input) {
    if (["number", "range"].includes(input.type)) {
      return Number(value);
    }
    if (input.type === "checkbox") {
      if (typeof value === "string" && !["on", "off"].includes(value)) {
        return Array.from(root.querySelectorAll(`[name="${key}"]:checked`)).map(
          (input) => {
            return (input as HTMLInputElement).value;
          }
        );
      } else {
        return (input as HTMLInputElement).checked;
      }
    }
    if (input.type === "radio") {
      const _input = root.querySelector(`[name="${key}"]:checked`);
      return _input?.checked ? value : null;
    }
    if (input instanceof HTMLSelectElement && input.multiple) {
      return Array.from(input.options)
        .filter((option) => option.selected)
        .map((option) => option.value);
    }
    return value;
  }
  return value;
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Serialize a form to a nested JSON object. Field names are paths
 * (`address.city`, `tags[]`); values are typed from the control
 * (`number` / `range` → number, checkbox → boolean or checked-values array,
 * multi-select → array). Form-associated controls (`form="id"`) count like
 * descendants, as they do for `FormData`.
 *
 * Controls are indexed once by `name` from `form.elements`, so a form with
 * thousands of fields serializes in one pass (no per-field selector query).
 */
export function formToJson(form: HTMLFormElement) {
  const json = {};
  const formData = new FormData(form);
  /* name → controls, document order. `form.elements` also lists
   * controls associated via `form=`, matching `FormData`. */
  const byName = new Map<string, FormControl[]>();
  for (const control of Array.from(form.elements) as FormControl[]) {
    const name = control.getAttribute("name");
    if (!name) continue;
    const list = byName.get(name);
    if (list) list.push(control);
    else byName.set(name, [control]);
  }
  const formEntries: Array<[string, FormDataEntryValue | string]> = [
    ...formData.entries(),
    // include unchecked checkboxes
    ...Array.from(
      form.querySelectorAll<HTMLInputElement>(
        "input[name][type='checkbox']:not([value]):not(:checked)"
      )
    ).map((input): [string, string] => [
      input.name,
      input.checked ? input.value : "off",
    ]),
  ];
  const arrayPaths = {};
  formEntries.forEach(([key, value]) => {
    if (key?.includes("[]")) {
      if (isNumber(arrayPaths[key])) {
        arrayPaths[key] += 1;
      } else {
        arrayPaths[key] = 0;
      }
      const arrayKey = key.replace("[]", `[${arrayPaths[key]}]`);
      const found = byName.get(key)?.find((control) => control.value === value);
      const parsedValue = parseFormInputValue(form, found, key, value);
      pathval.setPathValue(json, arrayKey, parsedValue);
    } else if (key) {
      const parsedValue = parseFormInputValue(
        form,
        byName.get(key)?.[0],
        key,
        value
      );
      pathval.setPathValue(json, key, parsedValue);
    }
  });
  return json;
}
