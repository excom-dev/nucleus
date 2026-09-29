import { invokeCommand } from "@excom/neutron";
import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

const position = {
  coords: { latitude: 51.5072, longitude: -0.1276, accuracy: 20 },
  timestamp: 1700000000000,
};

describe("request view", () => {
  let getCurrentPosition: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getCurrentPosition = vi.fn((success) => setTimeout(() => success(position), 0));
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
      writable: true,
      configurable: true,
    });
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const request = async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "request"));
    const provider = root.querySelector("provider-geolocation")!;
    const button = root.querySelector<HTMLButtonElement>("button[command]")!;
    expect(provider.hasAttribute("is-paused")).toBe(true);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(button.getAttribute("command")).toBe("--request");
    return { root, quark, provider, button };
  };

  it("prints the position read on request", async () => {
    const { root, quark, provider, button } = await request();
    const meter = measureComplexity(quark!);
    await waitForEvent(provider, "provider-geolocation-success", () => {
      invokeCommand(provider, "--request", button);
    });
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toBe("51.5072, -0.1276");
    expectComplexity(budget);
  });

  it("prints the error message when the request fails", async () => {
    getCurrentPosition.mockImplementation((_success, error) =>
      setTimeout(() => error({ code: 1, message: "User denied Geolocation" }), 0),
    );
    const { root, provider, button } = await request();
    await waitForEvent(provider, "provider-geolocation-error", () => {
      invokeCommand(provider, "--request", button);
    });
    await flush();
    expect(root.querySelector("output")?.textContent).toBe(
      "User denied Geolocation",
    );
  });
});
