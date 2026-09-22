import { Quark } from "../../index";
import {
  fixture,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as demoUtils from "../../../docs-site/public/demo-utils";
import { flush } from "./helpers";

export {
  bypassSelectorCache,
  expectComplexity,
  flush,
  measureComplexity,
} from "./helpers";

const originalLoader = Quark.moduleLoader;

/** Resolve `@use "/demo-utils"` the way the docs-site live demos do. */
export const installDemoModules = (extra?: Record<string, unknown>) => {
  Quark.moduleLoader = async (url: string) => {
    if (url.includes("demo-utils")) return { ...demoUtils, ...extra };
    if (extra) {
      for (const key of Object.keys(extra)) {
        if (url.includes(key)) return extra;
      }
    }
    return originalLoader(url);
  };
  return () => {
    Quark.moduleLoader = originalLoader;
  };
};

export const restoreDemoModules = () => {
  Quark.moduleLoader = originalLoader;
};

export const readViewFile = (fromImportMetaUrl: string, relPath: string) =>
  readFileSync(
    resolve(dirname(fileURLToPath(fromImportMetaUrl)), relPath),
    "utf8"
  );

export const readDemo = (fromImportMetaUrl: string, name: string) =>
  readViewFile(fromImportMetaUrl, `../demos/${name}.html`);

const stripAssets = (html: string) =>
  html.replace(/<link[\s\S]*?>/g, "").replace(/\s+src-url="[^"]*"/g, "");

/** Mount a demo / view. Inline `quarkSrc` when the sheet used `src-url`. */
export const mountView = async (
  html: string,
  quarkSrc?: string
): Promise<{
  root: HTMLElement;
  sheet: HTMLQuarkSheetElement | null;
  quark: InstanceType<typeof Quark> | undefined;
}> => {
  const wrap = document.createElement("div");
  wrap.innerHTML = stripAssets(html);
  const kids = [...wrap.children] as HTMLElement[];
  const root = (kids.length === 1 ? kids[0] : wrap) as HTMLElement;
  const sheet = wrap.querySelector<HTMLQuarkSheetElement>("quark-sheet");
  if (sheet && quarkSrc) sheet.textContent = quarkSrc;
  document.body.append(wrap);
  if (sheet && !sheet.quarkInstance) {
    await waitForEvent(sheet, "quark-sheet-success");
  }
  await flush();
  return { root, sheet, quark: sheet?.quarkInstance };
};

export const click = (el: Element | null) => {
  if (!el) throw new Error("click: missing element");
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true })
  );
};
