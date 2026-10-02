// `node --import` this to run `nucleus-ssr.mjs` without a build: its
// `./dist/cli.js` resolves to `stub-cli.mjs`.
import { registerHooks } from "node:module";

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "./dist/cli.js"
      ? { url: new URL("stub-cli.mjs", import.meta.url).href, shortCircuit: true }
      : next(specifier, context),
});
