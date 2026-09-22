import { ConstructorType, Neutron, TokenList } from "@excom/neutron";

// Feature name → sync support predicate. Prefer simple `in` / property
// checks; skip anything that needs probing, permissions, or user gestures.
const FEATURE_CHECKS = {
  geolocation: () => "geolocation" in navigator,
  vibrate: () => "vibrate" in navigator,
  bluetooth: () => "bluetooth" in navigator,
  usb: () => "usb" in navigator,
  serial: () => "serial" in navigator,
  hid: () => "hid" in navigator,
  share: () => "share" in navigator,
  clipboard: () => "clipboard" in navigator,
  credentials: () => "credentials" in navigator,
  "media-devices": () => "mediaDevices" in navigator,
  "service-worker": () => "serviceWorker" in navigator,
  storage: () => "storage" in navigator,
  "wake-lock": () => "wakeLock" in navigator,
  gpu: () => "gpu" in navigator,
  locks: () => "locks" in navigator,
  permissions: () => "permissions" in navigator,
  connection: () => "connection" in navigator,
  "user-agent-data": () => "userAgentData" in navigator,
  battery: () => "getBattery" in navigator,
  midi: () => "requestMIDIAccess" in navigator,
  webxr: () => "xr" in navigator,
  "virtual-keyboard": () => "virtualKeyboard" in navigator,
  "window-controls-overlay": () => "windowControlsOverlay" in navigator,
  contacts: () => "contacts" in navigator,
  "local-storage": () => "localStorage" in globalThis,
  "session-storage": () => "sessionStorage" in globalThis,
  "indexed-db": () => "indexedDB" in globalThis,
  notification: () => "Notification" in globalThis,
  "payment-request": () => "PaymentRequest" in globalThis,
  "web-socket": () => "WebSocket" in globalThis,
  worker: () => "Worker" in globalThis,
  "shared-worker": () => "SharedWorker" in globalThis,
  "broadcast-channel": () => "BroadcastChannel" in globalThis,
  "intersection-observer": () => "IntersectionObserver" in globalThis,
  "resize-observer": () => "ResizeObserver" in globalThis,
  "speech-synthesis": () => "speechSynthesis" in globalThis,
  "eye-dropper": () => "EyeDropper" in globalThis,
  "barcode-detector": () => "BarcodeDetector" in globalThis,
  "file-system-access": () => "showOpenFilePicker" in globalThis,
  webrtc: () => "RTCPeerConnection" in globalThis,
  dialog: () => "HTMLDialogElement" in globalThis,
  "view-transitions": () => "startViewTransition" in Document.prototype,
  "cookie-store": () => "cookieStore" in globalThis,
  "offscreen-canvas": () => "OffscreenCanvas" in globalThis,
} as const;

type FeatureName = keyof typeof FEATURE_CHECKS;

export type FeatureInfo = {
  fullSupport: FeatureName[];
  noSupport: FeatureName[];
};

/**
 * Feature-detection provider — flags browser API support as CSS-selectable
 * tokens on connect (geolocation, share, bluetooth, clipboard, and more).
 * The same partitions are available as arrays on `.provision` for JS / Quark.
 *
 * @summary CSS-selectable feature support tokens.
 *
 * @example
 * <detect-features></detect-features>
 * <!-- detect-features:not([full-support~="geolocation"]) ... -->
 */
export const DetectFeatures = Neutron({
  tag: "detect-features",
  props: {
    /**
     * @state
     * Space-separated feature names fully supported by this browser.
     * @values geolocation | vibrate | bluetooth | usb | serial | hid | share | clipboard | credentials | media-devices | service-worker | storage | wake-lock | gpu | locks | permissions | connection | user-agent-data | battery | midi | webxr | virtual-keyboard | window-controls-overlay | contacts | local-storage | session-storage | indexed-db | notification | payment-request | web-socket | worker | shared-worker | broadcast-channel | intersection-observer | resize-observer | speech-synthesis | eye-dropper | barcode-detector | file-system-access | webrtc | dialog | view-transitions | cookie-store | offscreen-canvas
     */
    fullSupport: TokenList,
    /**
     * @state
     * Reserved for features with partial / conditional support. Not
     * populated yet — see `INTERNAL.md`.
     */
    partialSupport: TokenList,
    /**
     * @state
     * Space-separated feature names with no support in this browser.
     * @values geolocation | vibrate | bluetooth | usb | serial | hid | share | clipboard | credentials | media-devices | service-worker | storage | wake-lock | gpu | locks | permissions | connection | user-agent-data | battery | midi | webxr | virtual-keyboard | window-controls-overlay | contacts | local-storage | session-storage | indexed-db | notification | payment-request | web-socket | worker | shared-worker | broadcast-channel | intersection-observer | resize-observer | speech-synthesis | eye-dropper | barcode-detector | file-system-access | webrtc | dialog | view-transitions | cookie-store | offscreen-canvas
     */
    noSupport: TokenList,
    /**
     * @state
     * Reserved for features that require an explicit permission grant.
     * Not populated yet — see `INTERNAL.md`.
     */
    grantedPermissions: TokenList,
    /**
     * @provision
     * Same partitions as the token attributes, as string arrays for JS /
     * Quark (`fullSupport`, `noSupport`). Not reflected as an attribute.
     * @type FeatureInfo
     */
    provision: Object as unknown as ConstructorType<FeatureInfo>,
  },
})
  .defineMethods({
    setFeatures: () => {
      const entries = (Object.keys(FEATURE_CHECKS) as FeatureName[]).map(
        (name) => [name, FEATURE_CHECKS[name]()] as const
      );
      const fullSupport = entries.filter(([, ok]) => ok).map(([name]) => name);
      const noSupport = entries.filter(([, ok]) => !ok).map(([name]) => name);
      return {
        fullSupport,
        noSupport,
        provision: {
          fullSupport,
          noSupport,
        },
      };
    },
  })
  .onConnected(
    // no point in running this logic if the component has already done it
    // in a previous connection
    ({ wasMounted }) => !wasMounted && { setFeatures: [] }
  );
