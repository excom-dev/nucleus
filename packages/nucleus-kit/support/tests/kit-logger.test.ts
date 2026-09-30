/**
 * An app that loads only Nucleus Kit sets the log level through the kit's own
 * `KitLogger` export; it must be the logger the elements use.
 */
import { KitLogger as exported, QuarkLogger } from "../../index";
import { KitLogger } from "@excom/kit-logger";
import { flush, unregisterAll } from "@excom/quark/support/tests/helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("nucleus-kit: KitLogger export", () => {
  const level = KitLogger.level;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    KitLogger.level = level;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("is the object @excom/kit-logger exports", () => {
    expect(exported).toBe(KitLogger);
  });

  it("sets what a Nucleus Kit element logs", () => {
    // warns once per element, so each check gets a fresh one
    const blankKeycode = () =>
      fixture<any>(
        `<event-handler keycode-filter=" "></event-handler>`
      ).handleEvent(new KeyboardEvent("keydown", { key: " " }));

    exported.level = 1;
    blankKeycode();
    expect(console.warn).not.toHaveBeenCalled();

    exported.level = 2;
    blankKeycode();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.warn).mock.calls[0])).toMatch(
      /keycode-filter names no key/
    );
  });
});

describe("nucleus-kit: QuarkLogger export", () => {
  const level = QuarkLogger.level;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    QuarkLogger.level = level;
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // an expression that cannot resolve: Quark logs an error, shown by default
  const failingSheet = async () => {
    fixture(
      `<section><quark-sheet>[bind-x] { content: missing(); }</quark-sheet><p bind-x></p></section>`
    );
    await flush();
  };

  // a static import of Quark would load all of it (~42 kB gzip) on every page
  it("is not exported by the progressive entry", async () => {
    const progressive = await import("../../nucleus-kit.progressive");
    expect(progressive).not.toHaveProperty("QuarkLogger");
  });

  it("is the logger Quark logs through", async () => {
    const error = vi.spyOn(QuarkLogger, "error");
    await failingSheet();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ method: "resolveExpression" })
    );
  });

  it("sets what Quark logs", async () => {
    await failingSheet();
    expect(console.error).toHaveBeenCalled();

    vi.mocked(console.error).mockClear();
    QuarkLogger.level = 0;
    await failingSheet();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("is independent of KitLogger", () => {
    QuarkLogger.level = 0;
    expect(exported.level).not.toBe(0);
  });
});
