/**
 * The type tests in `types/`, compiled: Vitest strips types unread, and the
 * package's own tsconfig leaves tests out.
 */
import { describe, expect, it } from "@excom/nucleus-test";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = join(dirname(fileURLToPath(import.meta.url)), "types");
// the rig's compiler: the package has none of its own
const ts = createRequire(join(TYPES, "../../../node_modules/@excom/heft-rig/package.json"))("typescript");

describe("type tests", () => {
  it("compile: each @ts-expect-error marks an error, and nothing else is one", { timeout: 120_000 }, () => {
    const { config } = ts.readConfigFile(join(TYPES, "tsconfig.json"), ts.sys.readFile);
    const { options, fileNames, errors } = ts.parseJsonConfigFileContent(config, ts.sys, TYPES);
    expect(errors).toEqual([]);
    expect(fileNames.map((file: string) => basename(file))).toEqual(["define-config.ts"]);
    const diagnostics = ts
      .getPreEmitDiagnostics(ts.createProgram(fileNames, options))
      .map(
        ({ file, start, messageText }: { file?: { fileName: string; getLineAndCharacterOfPosition(at: number): { line: number } }; start?: number; messageText: unknown }) =>
          `${file ? `${basename(file.fileName)}:${file.getLineAndCharacterOfPosition(start ?? 0).line + 1} ` : ""}${ts.flattenDiagnosticMessageText(messageText, " ")}`
      );
    expect(diagnostics).toEqual([]);
  });
});
