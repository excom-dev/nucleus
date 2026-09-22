import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

describe("dialog-anchor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens and closes dialog properly", async () => {
    fixture<HTMLDivElement>(
      `<div>
        <dialog-anchor target-ref="dialog" id="c"></dialog-anchor>
      </div>
      <dialog>
        <dialog-anchor id="b"></dialog-anchor>
      </dialog>
      <dialog-anchor is-modal target-ref="dialog:has(+:scope)" id="a"></dialog-anchor>`,
    );
    const dialogAnchor1 = document.querySelector(
      "#a",
    ) as HTMLDialogAnchorElement;
    const dialogAnchor2 = document.querySelector(
      "#b",
    ) as HTMLDialogAnchorElement;
    const dialogAnchor3 = document.querySelector(
      "#c",
    ) as HTMLDialogAnchorElement;
    const dialog = document.querySelector("dialog")!;
    const showSpy = vi.spyOn(dialog, "show");
    const showModalSpy = vi.spyOn(dialog, "showModal");
    const closeSpy = vi.spyOn(dialog, "close");

    expect(dialog.open).toBe(false);

    // modal, previous sibling
    dialogAnchor1.dispatchEvent(new Event("click"));
    expect(showModalSpy).toHaveBeenCalled();
    expect(showSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    // close, child
    dialogAnchor2.dispatchEvent(new Event("click"));
    expect(closeSpy).toHaveBeenCalled();

    // non-modal, target-ref
    dialogAnchor3.dispatchEvent(new Event("click"));
    expect(showSpy).toHaveBeenCalled();
    expect(dialog.open).toBe(true);

    // toggle
    dialogAnchor3.dispatchEvent(new Event("click"));
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });
});

describe("dialog-anchor (no dialog)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("does nothing when neither target-ref nor an ancestor resolves to a dialog", () => {
    const wrapper = fixture<HTMLDivElement>(
      `<div>
        <p id="not-a-dialog"></p>
        <dialog-anchor target-ref="#not-a-dialog" id="x"></dialog-anchor>
        <dialog-anchor target-ref="#missing" id="y"></dialog-anchor>
        <dialog-anchor id="z"></dialog-anchor>
      </div>`,
    );
    const showSpy = vi.spyOn(HTMLDialogElement.prototype, "show");
    const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const closeSpy = vi.spyOn(HTMLDialogElement.prototype, "close");
    wrapper.querySelectorAll("dialog-anchor").forEach((anchor) => {
      expect(() => anchor.dispatchEvent(new Event("click"))).not.toThrow();
    });
    expect(showSpy).not.toHaveBeenCalled();
    expect(showModalSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("falls back to the closest dialog when target-ref is not a dialog", () => {
    fixture<HTMLDialogElement>(
      `<dialog>
        <p id="inner-p"></p>
        <dialog-anchor target-ref="#inner-p" is-modal></dialog-anchor>
      </dialog>`,
    );
    const dialog = document.querySelector("dialog")!;
    const showModalSpy = vi.spyOn(dialog, "showModal");
    document.querySelector("dialog-anchor")!.dispatchEvent(new Event("click"));
    expect(showModalSpy).toHaveBeenCalledTimes(1);
  });
});
