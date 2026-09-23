import {
  cssConfig,
  heftRigCssPlugin,
} from "@excom/heft-rig/scripts/css-config.mjs";
import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Nucleus DevTools",
    description:
      "Element sidebar — Neutron lifecycle and Quark orchestration publications for the selected element",
    // `browser.storage.session` holds the global heatmap toggle.
    permissions: ["storage"],
  },
  // The npm name is scoped; WXT would otherwise emit
  // `excomnucleus-devtools-<version>-chrome.zip`.
  zip: { name: "nucleus-devtools" },
  webExt: {
    startUrls: ["http://localhost:3001/"],
  },
  vite: () => ({
    css: cssConfig,
    plugins: [heftRigCssPlugin()],
  }),
});
