import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";
import { propsFromSource } from "../../content-drawer";
import { invokeCommand } from "@excom/neutron";

/** A `<button>` invoker carrying `data-*` from `data` (camelCase keys). */
const sourceWith = (data: Record<string, unknown> = {}) => {
  const button = document.createElement("button");
  Object.entries(data).forEach(([key, value]) => {
    button.dataset[key] = String(value);
  });
  return button;
};

/** Invoke a command from a `<button>` and let the handler's microtask run. */
const command = async (
  el: Element,
  name: string,
  data?: Record<string, unknown>,
) => {
  invokeCommand(el, name, sourceWith(data));
  await Promise.resolve();
};

describe("content-drawer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens, closes and toggles from commands", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer></content-drawer>`,
    );
    await command(contentDrawer, "--open");
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer is-open></content-drawer>`,
    );
    await command(contentDrawer, "--close");
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer></content-drawer>`,
    );
    await command(contentDrawer, "--toggle");
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer is-open></content-drawer>`,
    );
    await command(contentDrawer, "--toggle");
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer></content-drawer>`,
    );
  });

  it("adds no document listeners on open (dismissal is dismiss-watcher's job)", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    const documentAddSpy = vi.spyOn(document, "addEventListener");
    const bodyAddSpy = vi.spyOn(document.body, "addEventListener");
    await command(contentDrawer, "--open");
    expect(documentAddSpy).not.toHaveBeenCalled();
    expect(bodyAddSpy).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(contentDrawer.isOpen).toBe(true);
  });

});

describe("content-drawer (propsFromSource)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps only declared, non-private props", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    expect(
      propsFromSource(
        contentDrawer,
        sourceWith({
          openStage: 1,
          fromSide: "top",
          unknownKey: "x",
          _timeoutId: 123,
          isOpen: false,
        }),
      ),
    ).toEqual({ openStage: "1", fromSide: "top", isOpen: "false" });
    expect(propsFromSource(contentDrawer, undefined)).toEqual({});
    expect(propsFromSource(contentDrawer, null)).toEqual({});
    expect(propsFromSource(contentDrawer, sourceWith())).toEqual({});
  });

  it("applies openStage from the invoker's data-* and ignores unknown / private keys", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    await command(contentDrawer, "--open", { openStage: 1, unknownKey: "x", _timeoutId: 123 });
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer is-open open-stage="1"></content-drawer>`,
    );
    expect(contentDrawer._timeoutId).toBeFalsy();
    expect((contentDrawer as unknown as { unknownKey?: unknown }).unknownKey).toBeUndefined();
  });

  it("isOpen on the invoker cannot override the command", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    await command(contentDrawer, "--open", { isOpen: false });
    expect(contentDrawer.isOpen).toBe(true);
    await command(contentDrawer, "--toggle", { isOpen: true });
    expect(contentDrawer.isOpen).toBe(false);
  });
});

describe("content-drawer (open stages)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("sets open-stage from the invoker and keeps it on close", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    await command(contentDrawer, "--open", { openStage: "1" });
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer is-open open-stage="1"></content-drawer>`,
    );
    expect(contentDrawer.openStage).toBe(1);
    await command(contentDrawer, "--open", { openStage: 2 });
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer is-open open-stage="2"></content-drawer>`,
    );
    await command(contentDrawer, "--open", { openStage: 0 });
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer is-open open-stage="0"></content-drawer>`,
    );
    await command(contentDrawer, "--close");
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer open-stage="0"></content-drawer>`,
    );
  });

  it("toggle accepts declared props from the invoker and drops the rest", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    await command(contentDrawer, "--toggle", { openStage: 2, isModal: true, fromSide: "top" });
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer is-open open-stage="2" from-side="top"></content-drawer>`,
    );
    await command(contentDrawer, "--toggle");
    // declared props set through the invoker persist like any attribute
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer open-stage="2" from-side="top"></content-drawer>`,
    );
  });

  it("open-stage only accepts 0, 1, or 2", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    contentDrawer.openStage = -1;
    // attribute reflects as written, but the prop reads as invalid (null)
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer open-stage="-1"></content-drawer>`,
    );
    expect(contentDrawer.openStage).toBe(null);
    contentDrawer.openStage = 3;
    expect(contentDrawer.openStage).toBe(null);
    contentDrawer.openStage = 2;
    expect(contentDrawer.openStage).toBe(2);
  });
});

describe("content-drawer (opened / closed events)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("emits content-drawer-opened after open and -closed after close", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    const opened = vi.fn();
    const closed = vi.fn();
    contentDrawer.addEventListener("content-drawer-opened", opened);
    contentDrawer.addEventListener("content-drawer-closed", closed);

    await command(contentDrawer, "--open");
    expect(opened).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    expect(contentDrawer.hasAttribute("is-open")).toBe(true);
    expect(opened.mock.calls[0][0].detail).toBe(contentDrawer);

    await command(contentDrawer, "--close");
    expect(closed).toHaveBeenCalledTimes(1);
    expect(contentDrawer.hasAttribute("is-open")).toBe(false);
    expect(closed.mock.calls[0][0].detail).toBe(contentDrawer);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("emits opened without a singleton-name", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer></content-drawer>`,
    );
    const opened = vi.fn();
    contentDrawer.addEventListener("content-drawer-opened", opened);
    contentDrawer.isOpen = true;
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe("content-drawer (disappear-after)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("disappears after a set time", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer disappear-after="0.1"></content-drawer>`,
    );
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer disappear-after="0.1"></content-drawer>`,
    );
    await command(contentDrawer, "--open");
    expect(contentDrawer).dom.to.equalTag(
      `<content-drawer disappear-after="0.1" is-open></content-drawer>`,
    );
    // poll rather than sleeping the timer's own 100ms: an exact-length sleep
    // loses the race whenever the machine is slow enough to start it late
    await vi.waitFor(() => {
      expect(contentDrawer).dom.to.equalTag(
        `<content-drawer disappear-after="0.1"></content-drawer>`,
      );
    });
    expect(contentDrawer._timeoutId).toBeNull();
  });

  it("clears the timer when closed early", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer disappear-after="0.1"></content-drawer>`,
    );
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await command(contentDrawer, "--open");
    const id = contentDrawer._timeoutId;
    expect(id).not.toBeNull();
    await command(contentDrawer, "--close");
    expect(clearSpy).toHaveBeenCalledWith(id);
    expect(contentDrawer._timeoutId).toBeNull();
  });

  it("clears the timer on disconnect", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer disappear-after="0.1"></content-drawer>`,
    );
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await command(contentDrawer, "--open");
    const id = contentDrawer._timeoutId;
    expect(id).not.toBeNull();
    contentDrawer.remove();
    await wait(0);
    expect(clearSpy).toHaveBeenCalledWith(id);
    expect(contentDrawer._timeoutId).toBeNull();
    // the timer no longer closes it
    await wait(110);
    expect(contentDrawer.isOpen).toBe(true);
  });

  it("keeps the timer across a DOM move", async () => {
    const contentDrawer = fixture<HTMLContentDrawerElement>(
      `<content-drawer disappear-after="0.1"></content-drawer>`,
    );
    await command(contentDrawer, "--open");
    const id = contentDrawer._timeoutId;
    expect(id).not.toBeNull();
    const target = document.createElement("div");
    document.body.append(target);
    target.append(contentDrawer); // synchronous disconnect + connect = move
    await wait(0);
    expect(contentDrawer._timeoutId).toBe(id);
    expect(contentDrawer.isOpen).toBe(true);
    await wait(110);
    expect(contentDrawer.isOpen).toBe(false);
  });
});

describe("content-drawer (singleton-name)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("closes when another drawer with the same name opens", async () => {
    const drawer1 = fixture<HTMLContentDrawerElement>(
      `<content-drawer singleton-name="foo"></content-drawer>
       <content-drawer singleton-name="foo"></content-drawer>
       <content-drawer singleton-name="bar"></content-drawer>`,
    );
    const drawer2 = drawer1.nextElementSibling as HTMLContentDrawerElement;
    const other = drawer2.nextElementSibling as HTMLContentDrawerElement;
    other.isOpen = true;

    await command(drawer1, "--open");
    expect(drawer1).dom.to.equalTag(
      `<content-drawer is-open singleton-name="foo"></content-drawer>`,
    );
    expect(drawer2).dom.to.equalTag(
      `<content-drawer singleton-name="foo"></content-drawer>`,
    );

    await command(drawer2, "--open");
    expect(drawer1).dom.to.equalTag(
      `<content-drawer singleton-name="foo"></content-drawer>`,
    );
    expect(drawer2).dom.to.equalTag(
      `<content-drawer is-open singleton-name="foo"></content-drawer>`,
    );
    // a different group is untouched
    expect(other.isOpen).toBe(true);
  });

  it("stops coordinating when singleton-name is removed", async () => {
    const drawer1 = fixture<HTMLContentDrawerElement>(
      `<content-drawer singleton-name="foo"></content-drawer>
       <content-drawer singleton-name="foo"></content-drawer>`,
    );
    const drawer2 = drawer1.nextElementSibling as HTMLContentDrawerElement;
    drawer1.isOpen = true;
    drawer2.removeAttribute("singleton-name");
    drawer2.isOpen = true;
    expect(drawer1.isOpen).toBe(true);
  });

  it("keeps coordinating after a DOM move", async () => {
    const drawer1 = fixture<HTMLContentDrawerElement>(
      `<content-drawer singleton-name="foo"></content-drawer>
       <content-drawer singleton-name="foo"></content-drawer>`,
    );
    const drawer2 = drawer1.nextElementSibling as HTMLContentDrawerElement;
    const target = document.createElement("div");
    document.body.append(target);
    target.append(drawer1); // move
    await wait(0);

    drawer1.isOpen = true;
    await command(drawer2, "--open");
    expect(drawer1.isOpen).toBe(false);
    expect(drawer2.isOpen).toBe(true);

    await command(drawer1, "--open");
    expect(drawer1.isOpen).toBe(true);
    expect(drawer2.isOpen).toBe(false);
  });

  it("keeps coordinating after a disconnect and reconnect", async () => {
    const drawer1 = fixture<HTMLContentDrawerElement>(
      `<content-drawer singleton-name="foo"></content-drawer>
       <content-drawer singleton-name="foo"></content-drawer>`,
    );
    const drawer2 = drawer1.nextElementSibling as HTMLContentDrawerElement;
    drawer1.remove();
    await wait(0);
    document.body.append(drawer1);
    await wait(0);

    drawer1.isOpen = true;
    await command(drawer2, "--open");
    expect(drawer1.isOpen).toBe(false);
    expect(drawer2.isOpen).toBe(true);
  });
});
