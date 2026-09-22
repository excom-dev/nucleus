import * as vscode from "vscode";
import { format } from "@excom/quark-formatter";

const SHEET_PATTERN = /(<quark-sheet\b[^>]*>)([\s\S]*?)(?=<\/quark-sheet>)/gi;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("quark", {
      provideDocumentFormattingEdits(document, options) {
        const source = document.getText();
        try {
          const formatted = format(source, {
            indent: indentUnit(options),
          });
          if (formatted === source) return [];
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(source.length),
          );
          return [vscode.TextEdit.replace(fullRange, formatted)];
        } catch (error) {
          // Parse error: leave the document alone rather than mangle it.
          vscode.window.setStatusBarMessage(
            `Quark: cannot format (${errorMessage(error)})`,
            5000,
          );
          return [];
        }
      },
    }),
    vscode.commands.registerCommand(
      "quark.formatSheets",
      formatQuarkSheetBlocks,
    ),
  );
}

function indentUnit(options: vscode.FormattingOptions): string {
  return options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Format every inline `<quark-sheet>` in the active HTML editor,
 * indented one level past the tag.
 */
async function formatQuarkSheetBlocks(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const { document } = editor;
  const tabSize = Number(editor.options.tabSize) || 2;
  const indent =
    editor.options.insertSpaces === false ? "\t" : " ".repeat(tabSize);

  const text = document.getText();
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const failures: string[] = [];

  for (const match of text.matchAll(SHEET_PATTERN)) {
    const inner = match[2];
    if (!inner.trim()) continue;
    const innerStart = match.index + match[1].length;
    // Indentation of the line the opening tag sits on.
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const baseIndent = /^[ \t]*/.exec(text.slice(lineStart, match.index))![0];
    try {
      const body = format(inner, { indent })
        .trimEnd()
        .split("\n")
        .map((line) => (line ? baseIndent + indent + line : line))
        .join("\n");
      const replacement = `\n${body}\n${baseIndent}`;
      if (replacement !== inner) {
        edits.push({
          start: innerStart,
          end: innerStart + inner.length,
          text: replacement,
        });
      }
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }

  if (edits.length) {
    await editor.edit((builder) => {
      for (const edit of edits) {
        builder.replace(
          new vscode.Range(
            document.positionAt(edit.start),
            document.positionAt(edit.end),
          ),
          edit.text,
        );
      }
    });
  }
  const summary = failures.length
    ? `Quark: formatted ${edits.length} sheet(s), ${failures.length} failed (${failures[0]})`
    : `Quark: formatted ${edits.length} sheet(s)`;
  vscode.window.setStatusBarMessage(summary, 5000);
}

export function deactivate(): void {}
