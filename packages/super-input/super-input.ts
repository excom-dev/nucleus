import { Neutron } from "@excom/neutron";
// TODO swap this library for something lighter.
import {
  format as formatInput,
  parse as parseInput,
  parseDigit,
  templateFormatter,
  templateParser,
} from "input-format";

const formatValue = (
  value: string,
  selection: number,
  textFormat: string,
  parseFormat?: string
) => {
  const parser = templateParser(parseFormat ?? textFormat, parseDigit);
  const formatter = templateFormatter(textFormat);
  return formatInput(parseInput(value, -1, parser).value, selection, formatter)
    .text;
};

/**
 * Wrapper around a native `<input>` that adds live text formatting, auto-labeling, and
 * a reflected value attribute. Does not replace the input — enhances it. Pair it with
 * `<super-form>` for form-level submission handling.
 *
 * @descendant input - Required native `<input>` to enhance.
 * @descendant ?label - Optional native `<label>`. When `auto-label` is set,
 *   its `for` attribute is linked to the input's `id`.
 *
 * @example Basic
 * <super-input auto-label>
 *   <label>Name</label>
 *   <input />
 * </super-input>
 *
 * @example With text formatting
 * <super-input text-format="(xxx) xxx-xxxx" auto-label>
 *   <label>Phone</label>
 *   <input pattern="^\(\d{3}\)\s\d{3}-\d{4}" />
 * </super-input>
 */
export const SuperInput = Neutron({
  tag: "super-input",
  props: {
    /**
     * @option
     * Pattern defining visible formatting. Use `x` for any digit and any
     * other character as a literal. Examples: `(xxx) xxx-xxxx`, `xx/xx/xxxx`,
     * `xxx-xx-xxxx`. When set, the input value is live-formatted on every
     * keystroke.
     */
    textFormat: String,
    /**
     * @option
     * If set, this message is installed via `setCustomValidity()` when the
     * native `invalid` event fires, and cleared on the next `keydown`. Makes
     * built-in HTML validation surface a custom message.
     */
    invalidMessage: String,
    /**
     * @option
     * When set, the current input value is mirrored to the `current-value`
     * attribute so CSS and selectors can respond to it. Off by default because
     * reflecting every keystroke is not free.
     */
    reflectValue: Boolean,
    /**
     * @state
     * Mirrors the wrapped `<input>`'s value when `reflect-value` is set.
     * Read-only from the app's point of view — writing it does not change
     * the input.
     */
    currentValue: String,
    /**
     * @option
     * When set, generates or uses an existing `id` on the `<input>` and associates the `<label>`.
     */
    autoLabel: Boolean,
    _inputElement: HTMLInputElement,
  },
})
  .defineMethods({
    doFormat: ({ textFormat, _inputElement }, parseFormat?: string) => {
      if ((!!textFormat || parseFormat) && _inputElement?.value) {
        return {
          _inputElement: {
            value: formatValue(
              _inputElement!.value,
              _inputElement!.selectionEnd ?? 0,
              textFormat ?? "",
              parseFormat
            ),
          },
        };
      }
    },
    setCurrentValue: ({ reflectValue, _inputElement }) => ({
      currentValue: reflectValue ? _inputElement?.value || null : null,
    }),
    handleInput: ({ reflectValue }) => [
      {
        doFormat: [],
      },
      reflectValue && {
        setCurrentValue: [],
      },
    ],
    handleInvalid: ({ invalidMessage }) =>
      invalidMessage && {
        _inputElement: {
          setCustomValidity: [invalidMessage],
        },
      },
    handleValid: () => ({
      _inputElement: {
        setCustomValidity: [""],
      },
    }),
  })
  .onConnected((el) => ({
    _inputElement: el.querySelector("input"),
  }))
  // formatting
  .onPropChanged(
    ["_inputElement", "reflectValue", "textFormat"],
    ({ _inputElement, reflectValue, textFormat, handleInput }, previous) => [
      // Rare: reformat the input programmatically
      { doFormat: [previous?.textFormat ?? undefined] },
      { setCurrentValue: [] },
      _inputElement && {
        _inputElement: {
          // Same handler so these tasks stay in order
          toggleListeners: [
            ["input", handleInput, reflectValue || !!textFormat],
          ],
        },
      },
    ]
  )
  .onPropChanged(
    ["_inputElement", "invalidMessage"],
    ({ _inputElement, invalidMessage, handleInvalid, handleValid }) =>
      !!_inputElement && {
        _inputElement: {
          toggleListeners: [
            ["invalid", handleInvalid, !!invalidMessage],
            ["keydown", handleValid, !!invalidMessage],
          ],
        },
      }
  )
  .onPropChanged(["_inputElement", "autoLabel"], (ce) => {
    const { _inputElement, autoLabel } = ce;
    const labelElement = ce.querySelector("label");
    if (_inputElement && autoLabel && labelElement) {
      const labelValue =
        _inputElement.id ||
        labelElement.htmlFor ||
        "super-input-" + Math.random().toString(36).substring(2, 10);
      _inputElement.id = labelValue;
      labelElement.htmlFor = labelValue;
    }
  });
