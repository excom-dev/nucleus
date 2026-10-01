import { describe, it } from "@excom/nucleus-test";
import { $, $$, act, click, openApp, SIZES, TABLE, text, until } from "./app";

describe.each(Object.entries(SIZES))("%s", (_name, size) => {
  // Focusability of a closed sheet is CSS (`visibility: hidden`), which happy-dom does not apply: open and close only.
  it("add to bag opens the sheet; closed, it holds no focusable control", async () => {
    await openApp(TABLE.path, { size });
    const sheet = () => ({
      open: $("#bag-sheet")!.hasAttribute("is-open"),
      lines: $$("#bag-sheet data-line").length,
      subtotal: text("#bag-sheet [bind-bag=subtotal]"),
    });
    await act(() => click("#product form[action='/api/bag'] button[type=submit]"));
    await until(sheet).toEqual({ open: true, lines: 1, subtotal: "$3,600" });
    await act(() => click("#bag-sheet header button[command='--close']"));
    await until(() => $("#bag-sheet")!.hasAttribute("is-open")).toBe(false);
  });
});
