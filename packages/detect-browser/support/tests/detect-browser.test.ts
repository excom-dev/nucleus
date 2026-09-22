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

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  edgeWin10:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
  firefoxWin7:
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  androidStock:
    "Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; SM-T230 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
  chromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  operaPresto:
    "Opera/9.80 (Windows NT 6.3; WOW64) Presto/2.12.388 Version/12.18",
  ie11Win8: "Mozilla/5.0 (Windows NT 6.2; Trident/7.0; rv:11.0) like Gecko",
  ie10Win7: "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)",
  // Contrived: a Gecko/ token alongside WebKit, only WebKit/Blink should win
  geckoAndWebkit:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Gecko/20100101 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

/** A full desktop-Chrome navigator; override fields per test. */
const stubNavigator = (overrides: Record<string, unknown> = {}) => {
  vi.stubGlobal("navigator", {
    userAgent: UA.chromeMac,
    userAgentData: { platform: "macOS" },
    vendor: "Google Inc.",
    platform: "MacIntel",
    language: "en-US",
    languages: ["en-US", "en"],
    cookieEnabled: true,
    doNotTrack: "1",
    standalone: false,
    hardwareConcurrency: 16,
    deviceMemory: 8,
    ...overrides,
  });
};

const mount = () =>
  fixture<HTMLDetectBrowserElement>(`<detect-browser></detect-browser>`);

describe("detect-browser", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("populates browser metadata", async () => {
    stubNavigator();

    const el = mount();
    expect(el).dom.to.equalTag(
      `<detect-browser
        browser-engine="blink"
        browser-name="chrome"
        browser-version="120.0.0.0"
        browser-vendor="google inc."
        cookies-enabled
        device-type="desktop"
        do-not-track="1"
        language-id="en-us"
        operating-platform="macos"
        operating-system="macos 10.15"
      ></detect-browser>`,
    );
    expect(el.provision).toEqual(
      expect.objectContaining({
        userAgent: expect.any(String),
        languageIds: ["en-US", "en"],
        hardwareConcurrency: 16,
        deviceMemory: 8,
      }),
    );
  });

  describe("browser / engine / OS detection", () => {
    it("detects Edge on Windows 10 as Blink", () => {
      stubNavigator({ userAgent: UA.edgeWin10, platform: "Win32" });
      const el = mount();
      expect(el.browserName).toBe("edge");
      expect(el.browserVersion).toBe("120.0.2210.91");
      expect(el.browserEngine).toBe("blink");
      expect(el.operatingSystem).toBe("windows 10+");
      expect(el.deviceType).toBe("desktop");
    });

    it("detects Firefox on Windows 7 as Gecko", () => {
      stubNavigator({ userAgent: UA.firefoxWin7, vendor: "" });
      const el = mount();
      expect(el.browserName).toBe("firefox");
      expect(el.browserVersion).toBe("121.0");
      expect(el.browserEngine).toBe("gecko");
      expect(el.operatingSystem).toBe("windows 7");
      // empty vendor string is reported as absent
      expect(el.hasAttribute("browser-vendor")).toBe(false);
      expect(el.browserVendor).toBe(null);
    });

    it("detects Firefox for iOS (FxiOS) as WebKit on a mobile device", () => {
      stubNavigator({ userAgent: UA.firefoxIos, vendor: "Apple Computer, Inc." });
      const el = mount();
      expect(el.browserName).toBe("firefox");
      expect(el.browserVersion).toBe("121.0");
      expect(el.browserEngine).toBe("webkit");
      expect(el.operatingSystem).toBe("ios");
      expect(el.deviceType).toBe("mobile");
    });

    it("detects Safari on macOS via the Version/ token", () => {
      stubNavigator({
        userAgent: UA.safariMac,
        vendor: "Apple Computer, Inc.",
        userAgentData: undefined,
      });
      const el = mount();
      expect(el).dom.to.equalTag(
        `<detect-browser
          browser-engine="webkit"
          browser-name="safari"
          browser-version="16.5"
          browser-vendor="apple computer, inc."
          cookies-enabled
          device-type="desktop"
          do-not-track="1"
          language-id="en-us"
          operating-platform="macintel"
          operating-system="macos 13.4"
        ></detect-browser>`,
      );
    });

    it("detects Safari on iPhone as iOS mobile", () => {
      stubNavigator({
        userAgent: UA.safariIos,
        platform: "iPhone",
        userAgentData: undefined,
      });
      const el = mount();
      expect(el.browserName).toBe("safari");
      expect(el.browserVersion).toBe("17.2");
      expect(el.operatingSystem).toBe("ios");
      expect(el.operatingPlatform).toBe("iphone");
      expect(el.deviceType).toBe("mobile");
    });

    it("detects Safari on iPad as iOS", () => {
      stubNavigator({ userAgent: UA.safariIpad });
      const el = mount();
      expect(el.browserName).toBe("safari");
      expect(el.operatingSystem).toBe("ios");
      expect(el.deviceType).toBe("mobile");
    });

    it("does not report the Android stock browser as Safari", () => {
      stubNavigator({ userAgent: UA.androidStock });
      const el = mount();
      expect(el.browserName).toBe(null);
      expect(el.hasAttribute("browser-name")).toBe(false);
      expect(el.browserVersion).toBe(null);
      expect(el.browserEngine).toBe("webkit");
      expect(el.operatingSystem).toBe("android");
      expect(el.deviceType).toBe("mobile");
    });

    it("detects Chrome on Android as Blink mobile", () => {
      stubNavigator({ userAgent: UA.chromeAndroid, platform: "Linux armv8l" });
      const el = mount();
      expect(el.browserName).toBe("chrome");
      expect(el.browserVersion).toBe("120.0.6099.144");
      expect(el.browserEngine).toBe("blink");
      expect(el.operatingSystem).toBe("android");
      expect(el.deviceType).toBe("mobile");
    });

    it("detects Chrome for iOS (CriOS)", () => {
      stubNavigator({ userAgent: UA.chromeIos });
      const el = mount();
      expect(el.browserName).toBe("chrome");
      expect(el.browserVersion).toBe("120.0.6099.119");
      expect(el.operatingSystem).toBe("ios");
    });

    it("detects Chrome on Linux", () => {
      stubNavigator({ userAgent: UA.chromeLinux, platform: "Linux x86_64" });
      const el = mount();
      expect(el.browserName).toBe("chrome");
      expect(el.operatingSystem).toBe("linux");
      expect(el.deviceType).toBe("desktop");
    });

    it("detects legacy (Presto) Opera on Windows 8.1 with no known engine", () => {
      stubNavigator({ userAgent: UA.operaPresto, vendor: undefined });
      const el = mount();
      expect(el.browserName).toBe("opera");
      expect(el.browserVersion).toBe("9.80");
      expect(el.browserEngine).toBe(null);
      expect(el.hasAttribute("browser-engine")).toBe(false);
      expect(el.operatingSystem).toBe("windows 8.1");
      expect(el.browserVendor).toBe(null);
    });

    it("detects Internet Explorer 11 (Trident, rv:) on Windows 8", () => {
      stubNavigator({ userAgent: UA.ie11Win8 });
      const el = mount();
      expect(el.browserName).toBe("internet explorer");
      expect(el.browserVersion).toBe("11.0");
      expect(el.browserEngine).toBe("trident");
      expect(el.operatingSystem).toBe("windows 8");
    });

    it("detects Internet Explorer 10 (MSIE) on Windows 7", () => {
      stubNavigator({ userAgent: UA.ie10Win7 });
      const el = mount();
      expect(el.browserName).toBe("internet explorer");
      expect(el.browserVersion).toBe("10.0");
      expect(el.browserEngine).toBe("trident");
      expect(el.operatingSystem).toBe("windows 7");
    });

    it("prefers WebKit/Blink over a stray Gecko/ token", () => {
      stubNavigator({ userAgent: UA.geckoAndWebkit });
      const el = mount();
      expect(el.browserEngine).toBe("blink");
    });
  });

  describe("platform / standalone / language", () => {
    it("falls back to navigator.platform when userAgentData is absent", () => {
      stubNavigator({ userAgentData: undefined, platform: "Win32" });
      const el = mount();
      expect(el.operatingPlatform).toBe("win32");
    });

    it("reports standalone from the display-mode media query", () => {
      vi.spyOn(window, "matchMedia").mockReturnValue({
        matches: true,
      } as MediaQueryList);
      stubNavigator();
      const el = mount();
      expect(window.matchMedia).toHaveBeenCalledWith(
        "(display-mode: standalone)",
      );
      expect(el.hasAttribute("is-standalone")).toBe(true);
      expect(el.provision?.isStandalone).toBe(true);
    });

    it("reports standalone from navigator.standalone (Safari)", () => {
      vi.spyOn(window, "matchMedia").mockReturnValue({
        matches: false,
      } as MediaQueryList);
      stubNavigator({ standalone: true });
      const el = mount();
      expect(el.hasAttribute("is-standalone")).toBe(true);
    });

    it("does not report standalone in a browser tab", () => {
      vi.spyOn(window, "matchMedia").mockReturnValue({
        matches: false,
      } as MediaQueryList);
      stubNavigator({ standalone: false });
      const el = mount();
      expect(el.hasAttribute("is-standalone")).toBe(false);
      expect(el.provision?.isStandalone).toBe(null);
    });

    it("lowercases the language and exposes the language list", () => {
      stubNavigator({ language: "es-MX", languages: ["es-MX", "es", "en"] });
      const el = mount();
      expect(el.languageId).toBe("es-mx");
      expect(el.provision?.languageIds).toEqual(["es-MX", "es", "en"]);
    });

    it("reflects cookies-enabled and do-not-track from navigator", () => {
      stubNavigator({ cookieEnabled: false, doNotTrack: "unspecified" });
      const el = mount();
      expect(el.hasAttribute("cookies-enabled")).toBe(false);
      expect(el.provision?.cookiesEnabled).toBe(false);
      expect(el.doNotTrack).toBe("unspecified");
    });
  });

  describe("sparse navigators", () => {
    it("reports null for everything the navigator does not expose", () => {
      vi.spyOn(window, "matchMedia").mockReturnValue({
        matches: false,
      } as MediaQueryList);
      vi.stubGlobal("navigator", { userAgent: "" });

      const el = mount();

      expect(el).dom.to.equalTag(
        `<detect-browser device-type="desktop"></detect-browser>`,
      );
      expect(el.provision).toEqual({
        browserName: null,
        browserVersion: null,
        browserEngine: null,
        browserVendor: null,
        operatingSystem: null,
        operatingPlatform: null,
        deviceType: "desktop",
        isStandalone: null,
        languageId: null,
        cookiesEnabled: null,
        doNotTrack: null,
        userAgent: null,
        languageIds: null,
        hardwareConcurrency: null,
        deviceMemory: null,
      });
    });

    it("treats a zero hardwareConcurrency as unknown", () => {
      stubNavigator({ hardwareConcurrency: 0, deviceMemory: 0 });
      const el = mount();
      expect(el.provision?.hardwareConcurrency).toBe(null);
      // deviceMemory is only null when undefined: 0 is a real value
      expect(el.provision?.deviceMemory).toBe(0);
    });
  });

  describe("provision", () => {
    it("publishes provision with neutron-provision on connect", () => {
      stubNavigator();
      const wrap = document.createElement("div");
      document.body.append(wrap);
      const spy = vi.fn();
      wrap.addEventListener("neutron-provision", spy);

      wrap.innerHTML = `<detect-browser></detect-browser>`;
      const el = wrap.firstElementChild as HTMLDetectBrowserElement;

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].target).toBe(el);
      expect(el.provision?.browserName).toBe("chrome");
    });

    it("mirrors every attribute field into provision", () => {
      stubNavigator({ userAgent: UA.edgeWin10 });
      const el = mount();
      expect(el.provision).toEqual(
        expect.objectContaining({
          browserName: "edge",
          browserVersion: "120.0.2210.91",
          browserEngine: "blink",
          browserVendor: "google inc.",
          operatingSystem: "windows 10+",
          operatingPlatform: "macos",
          deviceType: "desktop",
          languageId: "en-us",
          cookiesEnabled: true,
          doNotTrack: "1",
          userAgent: UA.edgeWin10,
        }),
      );
    });
  });

  describe("reconnection", () => {
    it("does not re-detect when reconnected after a previous mount", async () => {
      stubNavigator({ userAgent: UA.chromeMac });
      const el = mount();
      expect(el.browserName).toBe("chrome");

      el.remove();
      await wait(0);

      // a different navigator now, a fresh detection would say firefox
      stubNavigator({ userAgent: UA.firefoxWin7 });
      document.body.append(el);
      await wait(0);

      expect(el.browserName).toBe("chrome");
      expect(el.operatingSystem).toBe("macos 10.15");
    });

    it("keeps its attributes when moved synchronously within the document", () => {
      stubNavigator({ userAgent: UA.chromeMac });
      const el = mount();
      const parent = el.parentElement!;

      stubNavigator({ userAgent: UA.firefoxWin7 });
      el.remove();
      parent.append(el);

      expect(el.browserName).toBe("chrome");
    });
  });
});
