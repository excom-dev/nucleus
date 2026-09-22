import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/node_modules/vitest";
import { fixture } from "@excom/heft-rig/profiles/default/config/test-utils";

const FEATURES = [
  "geolocation",
  "vibrate",
  "bluetooth",
  "usb",
  "serial",
  "hid",
  "share",
  "clipboard",
  "credentials",
  "media-devices",
  "service-worker",
  "storage",
  "wake-lock",
  "gpu",
  "locks",
  "permissions",
  "connection",
  "user-agent-data",
  "battery",
  "midi",
  "webxr",
  "virtual-keyboard",
  "window-controls-overlay",
  "contacts",
  "local-storage",
  "session-storage",
  "indexed-db",
  "notification",
  "payment-request",
  "web-socket",
  "worker",
  "shared-worker",
  "broadcast-channel",
  "intersection-observer",
  "resize-observer",
  "speech-synthesis",
  "eye-dropper",
  "barcode-detector",
  "file-system-access",
  "webrtc",
  "dialog",
  "view-transitions",
  "cookie-store",
  "offscreen-canvas",
] as const;

describe("detect-features", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("partitions each feature into full-support or no-support", async () => {
    const el = fixture<HTMLDetectFeaturesElement>(
      `<detect-features></detect-features>`,
    );
    const full = [...el.fullSupport];
    const none = [...el.noSupport];
    const all = [...full, ...none].sort();

    expect(all).toEqual([...FEATURES].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(full.includes("geolocation")).toBe("geolocation" in navigator);
    expect(none.includes("geolocation")).toBe(!("geolocation" in navigator));
    expect(full.includes("bluetooth")).toBe("bluetooth" in navigator);
    expect(full.includes("share")).toBe("share" in navigator);
    expect(full.includes("local-storage")).toBe("localStorage" in globalThis);
    expect(full.includes("dialog")).toBe("HTMLDialogElement" in globalThis);
    expect(el.provision).toEqual({
      fullSupport: full,
      noSupport: none,
    });
  });
});
