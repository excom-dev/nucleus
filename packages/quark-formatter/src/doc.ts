/**
 * Minimal Wadler-style document printer, modelled on prettier's.
 *
 * A `Doc` describes text plus the places it *may* break. `printDoc` lays
 * it out against a print width: a `group` prints flat when its contents
 * fit on the rest of the line and breaks otherwise; `line` is a space
 * when flat and a newline when broken; `softline` is nothing when flat;
 * `hardline` always breaks and forces every enclosing group to break;
 * `fill` flows its parts like words in a paragraph, breaking only the
 * separators that would overflow.
 */

export type Doc = string | Doc[] | Group | Indent | IndentIfBreak | Line | Fill;

interface Group {
  kind: "group";
  contents: Doc;
  /** Set when the group contains a hard break (see `propagateBreaks`). */
  break: boolean;
  /** Lets `indentIfBreak` refer back to how this group was printed. */
  id?: symbol;
}

interface Indent {
  kind: "indent";
  contents: Doc;
}

/** Indents its contents only if the group with `groupId` was broken. */
interface IndentIfBreak {
  kind: "indentIfBreak";
  contents: Doc;
  groupId: symbol;
}

interface Line {
  kind: "line";
  soft: boolean;
  hard: boolean;
}

/** Parts alternate content / separator and end with content (odd length). */
interface Fill {
  kind: "fill";
  parts: Doc[];
}

export const group = (contents: Doc, id?: symbol): Group => ({
  kind: "group",
  contents,
  break: false,
  id,
});
export const indent = (contents: Doc): Indent => ({ kind: "indent", contents });
export const indentIfBreak = (
  contents: Doc,
  groupId: symbol
): IndentIfBreak => ({
  kind: "indentIfBreak",
  contents,
  groupId,
});
export const fill = (parts: Doc[]): Fill => ({ kind: "fill", parts });
export const line: Line = { kind: "line", soft: false, hard: false };
export const softline: Line = { kind: "line", soft: true, hard: false };
export const hardline: Line = { kind: "line", soft: false, hard: true };

/** `[a, sep, b, sep, c]` — the shape `fill` expects. */
export function join(separator: Doc, docs: Doc[]): Doc[] {
  const out: Doc[] = [];
  docs.forEach((doc, i) => {
    if (i) out.push(separator);
    out.push(doc);
  });
  return out;
}

export interface PrintDocOptions {
  /** Columns available per line; `Infinity` prints everything flat. */
  width: number;
  indentUnit: string;
  /** Indentation the first line starts with (and hard breaks return to). */
  rootIndent: string;
}

const FLAT = 0;
const BREAK = 1;
type Mode = typeof FLAT | typeof BREAK;

interface Cmd {
  ind: string;
  mode: Mode;
  doc: Doc;
}

/** Columns a tab occupies when measuring (VS Code's default `tabSize`). */
const TAB_WIDTH = 4;

export function printDoc(doc: Doc, options: PrintDocOptions): string {
  const { width, indentUnit, rootIndent } = options;
  propagateBreaks(doc);
  const out: string[] = [rootIndent];
  let pos = strWidth(rootIndent);
  const cmds: Cmd[] = [{ ind: rootIndent, mode: BREAK, doc }];
  /** How each id'd group was printed, for `indentIfBreak`. */
  const groupModes = new Map<symbol, Mode>();

  while (cmds.length) {
    const { ind, mode, doc } = cmds.pop()!;
    if (typeof doc === "string") {
      out.push(doc);
      pos += strWidth(doc);
      continue;
    }
    if (Array.isArray(doc)) {
      pushReversed(cmds, ind, mode, doc);
      continue;
    }
    switch (doc.kind) {
      case "indent":
        cmds.push({ ind: ind + indentUnit, mode, doc: doc.contents });
        break;
      case "indentIfBreak":
        cmds.push({
          ind: groupModes.get(doc.groupId) === BREAK ? ind + indentUnit : ind,
          mode,
          doc: doc.contents,
        });
        break;
      case "group": {
        const flat: Cmd = { ind, mode: FLAT, doc: doc.contents };
        const next: Cmd =
          mode === FLAT
            ? { ind, mode: doc.break ? BREAK : FLAT, doc: doc.contents }
            : !doc.break && fits(flat, cmds, width - pos, false)
              ? flat
              : { ind, mode: BREAK, doc: doc.contents };
        if (doc.id) groupModes.set(doc.id, next.mode);
        cmds.push(next);
        break;
      }
      case "fill": {
        const rem = width - pos;
        const { parts } = doc;
        const [content, separator, second] = parts;
        const contentFlat: Cmd = { ind, mode: FLAT, doc: content };
        const contentBreak: Cmd = { ind, mode: BREAK, doc: content };
        if (parts.length === 1) {
          // Last word: what follows the fill (`;`, `)`) counts against it.
          cmds.push(
            fits(contentFlat, cmds, rem, true) ? contentFlat : contentBreak
          );
          break;
        }
        const contentFits = fits(contentFlat, [], rem, true);
        const separatorFlat: Cmd = { ind, mode: FLAT, doc: separator };
        const separatorBreak: Cmd = { ind, mode: BREAK, doc: separator };
        const remaining: Cmd = { ind, mode, doc: fill(parts.slice(2)) };
        const pairFlat: Cmd = {
          ind,
          mode: FLAT,
          doc: [content, separator, second],
        };
        // The final pair also has to leave room for what follows the fill.
        const pairFits = fits(
          pairFlat,
          parts.length === 3 ? cmds : [],
          rem,
          true
        );
        if (pairFits) {
          cmds.push(remaining, separatorFlat, contentFlat);
        } else if (contentFits) {
          cmds.push(remaining, separatorBreak, contentFlat);
        } else {
          cmds.push(remaining, separatorBreak, contentBreak);
        }
        break;
      }
      case "line":
        if (mode === FLAT && !doc.hard) {
          if (!doc.soft) {
            out.push(" ");
            pos += 1;
          }
          break;
        }
        trimTrailing(out);
        out.push("\n" + ind);
        pos = strWidth(ind);
        break;
    }
  }
  return out.join("");
}

/**
 * Whether `next` fits in `width` columns when printed in its mode. `rest`
 * is the printer's pending stack (top last): once `next` is exhausted the
 * text that follows it is measured too, up to the first break in a
 * broken context. `mustBeFlat` rejects `next` if it holds a hard break.
 */
function fits(
  next: Cmd,
  rest: Cmd[],
  width: number,
  mustBeFlat: boolean
): boolean {
  let restIdx = rest.length;
  const cmds: Cmd[] = [next];
  while (width >= 0) {
    if (!cmds.length) {
      if (restIdx === 0) return true;
      cmds.push(rest[--restIdx]);
      mustBeFlat = false;
      continue;
    }
    const { ind, mode, doc } = cmds.pop()!;
    if (typeof doc === "string") {
      width -= strWidth(doc);
      continue;
    }
    if (Array.isArray(doc)) {
      pushReversed(cmds, ind, mode, doc);
      continue;
    }
    switch (doc.kind) {
      case "indent":
      case "indentIfBreak":
        // Indentation only matters after a break, which ends the measure.
        cmds.push({ ind, mode, doc: doc.contents });
        break;
      case "fill":
        pushReversed(cmds, ind, mode, doc.parts);
        break;
      case "group":
        if (mustBeFlat && doc.break) return false;
        cmds.push({ ind, mode: doc.break ? BREAK : mode, doc: doc.contents });
        break;
      case "line":
        if (mode === BREAK || doc.hard) return true;
        if (!doc.soft) width -= 1;
        break;
    }
  }
  return false;
}

/** Mark every group that contains a hard break (or a broken group) as broken. */
function propagateBreaks(doc: Doc): boolean {
  if (typeof doc === "string") return false;
  if (Array.isArray(doc)) return containsBreak(doc);
  switch (doc.kind) {
    case "line":
      return doc.hard;
    case "indent":
    case "indentIfBreak":
      return propagateBreaks(doc.contents);
    case "fill":
      return containsBreak(doc.parts);
    case "group": {
      if (propagateBreaks(doc.contents)) doc.break = true;
      return doc.break;
    }
  }
}

function containsBreak(docs: Doc[]): boolean {
  // Visit every child: propagation must reach all nested groups.
  let found = false;
  for (const doc of docs) if (propagateBreaks(doc)) found = true;
  return found;
}

function pushReversed(cmds: Cmd[], ind: string, mode: Mode, docs: Doc[]): void {
  for (let i = docs.length - 1; i >= 0; i--) {
    cmds.push({ ind, mode, doc: docs[i] });
  }
}

/** Drop spaces / tabs before a line break (`prop:` + hard break, indent-only lines). */
function trimTrailing(out: string[]): void {
  while (out.length) {
    const trimmed = out[out.length - 1].replace(/[ \t]+$/, "");
    if (trimmed) {
      out[out.length - 1] = trimmed;
      return;
    }
    out.pop();
  }
}

function strWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ch === "\t" ? TAB_WIDTH : 1;
  return width;
}
