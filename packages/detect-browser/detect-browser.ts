import { ConstructorType, Neutron } from "@excom/neutron";

export type BrowserInfo = {
  browserName: string | null;
  browserVersion: string | null;
  browserEngine: string | null;
  browserVendor: string | null;
  operatingSystem: string | null;
  operatingPlatform: string | null;
  deviceType: string | null;
  isStandalone: boolean | null;
  languageId: string | null;
  cookiesEnabled: boolean | null;
  doNotTrack: string | null;
  userAgent: string | null;
  languageIds: string[] | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
};

/**
 * Zero-JS browser / OS / device metadata provider. Sets attributes once on
 * connect so plain CSS can target Safari, iOS, standalone (installed PWA)
 * mode, and more — no app JavaScript required. Values with
 * no CSS-friendly attribute form (full user agent, language list, hardware
 * hints) live on the `.provision` property instead.
 *
 * @summary CSS-selectable browser, OS, and device metadata.
 *
 * @example
 * <detect-browser></detect-browser>
 * <!-- html:has(detect-browser[browser-name="safari"]) { ... } -->
 */
export const DetectBrowser = Neutron({
  tag: "detect-browser",
  props: {
    /**
     * @state
     * Detected browser family.
     * @values chrome | firefox | safari | edge | opera | internet explorer
     */
    browserName: String,
    /**
     * @state
     * Browser version, as reported by the user agent string.
     */
    browserVersion: String,
    /**
     * @state
     * Rendering engine.
     * @values blink | gecko | webkit | trident
     */
    browserEngine: String,
    /**
     * @state
     * `navigator.vendor`, lowercased.
     */
    browserVendor: String,
    /**
     * @state
     * Detected OS and, where available, version.
     * @values windows 10+ | windows 8.1 | windows 8 | windows 7 | macos <version> | android | ios | linux
     */
    operatingSystem: String,
    /**
     * @state
     * `navigator.userAgentData.platform` (falls back to
     * `navigator.platform`), lowercased.
     */
    operatingPlatform: String,
    /**
     * @state
     * Coarse device class inferred from the user agent string.
     * @values mobile | desktop
     */
    deviceType: String,
    /**
     * @state
     * Present when running in standalone / installed PWA mode.
     */
    isStandalone: Boolean,
    /**
     * @state
     * `navigator.language`, lowercased.
     */
    languageId: String,
    /**
     * @state
     * Present when `navigator.cookieEnabled` is `true`.
     */
    cookiesEnabled: Boolean,
    /**
     * @state
     * `navigator.doNotTrack`, as reported by the browser.
     */
    doNotTrack: String,
    /**
     * @provision
     * Every field above, plus values with no CSS-friendly attribute
     * form: full user agent string, `navigator.languages`, hardware
     * concurrency, and device memory (GB, where supported).
     * Not reflected as an attribute.
     * @type BrowserInfo
     */
    provision: Object as unknown as ConstructorType<BrowserInfo>,
  },
})
  .defineMethods({
    setBrowserInfo: () => {
      const nav = navigator;
      const ua = nav.userAgent || "";
      const platform = nav.userAgentData?.platform || nav.platform || undefined;

      // --- Browser name and version ---
      let name: string | undefined, version: string | undefined;
      if (/edg/i.test(ua)) {
        name = "Edge";
        version = ua.match(/edg\/([\d\.]+)/i)?.[1];
      } else if (/chrome|crios/i.test(ua)) {
        name = "Chrome";
        version = ua.match(/(?:chrome|crios)\/([\d\.]+)/i)?.[1];
      } else if (/firefox|fxios/i.test(ua)) {
        name = "Firefox";
        version = ua.match(/(?:firefox|fxios)\/([\d\.]+)/i)?.[1];
      } else if (/safari/i.test(ua) && !/chrome|crios|android/i.test(ua)) {
        name = "Safari";
        version = ua.match(/version\/([\d\.]+)/i)?.[1];
      } else if (/opr|opera/i.test(ua)) {
        name = "Opera";
        version = ua.match(/(?:opera|opr)\/([\d\.]+)/i)?.[1];
      } else if (/msie|trident/i.test(ua)) {
        name = "Internet Explorer";
        version = ua.match(/(?:msie |rv:)([\d\.]+)/i)?.[1];
      }

      // --- Engine detection ---
      let engine: string | undefined;
      if (/applewebkit/i.test(ua)) engine = "WebKit";
      if (/chrome|edg|opr/i.test(ua)) engine = "Blink";
      if (/gecko\//i.test(ua) && !/webkit/i.test(ua)) engine = "Gecko";
      if (/trident/i.test(ua)) engine = "Trident";

      // --- OS detection ---
      let os: string | undefined;
      if (/windows nt 10/i.test(ua)) os = "Windows 10+";
      else if (/windows nt 6\.3/i.test(ua)) os = "Windows 8.1";
      else if (/windows nt 6\.2/i.test(ua)) os = "Windows 8";
      else if (/windows nt 6\.1/i.test(ua)) os = "Windows 7";
      else if (/mac os x (\d+[\._]\d+)/i.test(ua))
        os =
          "macOS " + ua.match(/mac os x (\d+[\._]\d+)/i)?.[1].replace("_", ".");
      else if (/android/i.test(ua)) os = "Android";
      else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
      else if (/linux/i.test(ua)) os = "Linux";

      // --- Device type ---
      const isMobile = /mobi|android|iphone|ipad|ipod/i.test(ua);
      const deviceType = isMobile ? "Mobile" : "Desktop";
      const browserInfo = {
        browserName: name?.toLowerCase() || null,
        browserVersion: version?.toLowerCase() || null,
        browserEngine: engine?.toLowerCase() || null,
        browserVendor: nav.vendor?.toLowerCase() || null,
        operatingSystem: os?.toLowerCase() || null,
        operatingPlatform: platform?.toLowerCase() || null,
        deviceType: deviceType?.toLowerCase() || null,
        isStandalone:
          window.matchMedia("(display-mode: standalone)").matches ||
          //  ...for safari...
          nav.standalone ||
          null,
        languageId: nav.language?.toLowerCase() || null,
        cookiesEnabled: nav.cookieEnabled ?? null,
        doNotTrack: nav.doNotTrack ?? null,
      };
      return {
        ...browserInfo,
        provision: {
          ...browserInfo,
          userAgent: ua || null,
          languageIds: nav.languages || null,
          hardwareConcurrency: nav.hardwareConcurrency || null,
          deviceMemory: nav.deviceMemory ?? null,
        },
      };
    },
  })
  .onConnected(
    // Skip if we already ran this on a previous connection
    ({ wasMounted }) => {
      if (wasMounted) return;
      return {
        setBrowserInfo: [],
      };
    }
  );
