import { KitLogManager } from "@excom/kit-logger";
import { isNumber } from "@excom/kit-utils";

export const stringToHash = (str: string, seed: number = 0): string => {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0) + "";
};

export const getQuarkHost = (el: Element | null): HTMLElement =>
  ((["HTML", "HEAD", "BODY"].includes(el?.tagName as string)
    ? document.body
    : el) ?? document.body) as HTMLElement;

export const getQuarkMin = (sheet: string) => {
  return minifyQuark(sheet ?? "");
};

/**
 * Normalize sheet source before parsing: collapse horizontal whitespace
 * to one space and blank-line runs to one newline. Comments stay for the
 * parser (a regex pre-strip ate `//` inside strings like `"https://…"`).
 */
export function minifyQuark(scssString: string): string {
  return scssString
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .trim();
}

interface QuarkLog {
  method?: string;
  sheetId?: string;
  runId?: string;
  ruleId?: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}
export const QuarkLogger = new KitLogManager({
  namespace: "Quark",
  formatArgs: ([
    name,
    { method, sheetId, runId, ruleId, options, ...other },
  ]: QuarkLog[]) => [
    method !== "run" ? "    " : "",
    `${(runId || " ").padEnd(8)}  | `,
    `${(method || "").padEnd(15)}  | `,
    isNumber(sheetId) ? `sheet: ${sheetId}  | ` : "",
    isNumber(ruleId) ? `rule: ${ruleId?.toString().padEnd(3)}  | ` : "",
    "options: ",
    [options],
    ...Object.entries(other || {})
      .map(([key, value]) => [`  |  ${key}: `, value])
      .flat(2),
    `  |  (${name})`,
  ],
});

/**
 * Hot paths build log payloads (matched-element arrays, mutation maps)
 * that are discarded below `info`. Gate their construction.
 */
export const isInfoLogging = () => QuarkLogger.level >= 4;

export const deref = <T extends HTMLElement | Node>(
  el: T | WeakRef<T>
): T | undefined => {
  return el instanceof WeakRef ? el.deref() : el;
};
