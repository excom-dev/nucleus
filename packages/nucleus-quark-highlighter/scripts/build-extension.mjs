import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/* Bundle the extension entry (plus `@excom/quark-formatter` and its
   parser) into one self-contained CJS file so the .vsix has no runtime
   node_modules. */
await build({
  entryPoints: [path.join(pkgRoot, "src/extension.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node16",
  external: ["vscode"],
  outfile: path.join(pkgRoot, "dist/extension.cjs"),
  minify: true,
});

console.log("nucleus-quark-highlighter: built dist/extension.cjs");
