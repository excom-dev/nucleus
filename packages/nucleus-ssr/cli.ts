/**
 * `@excom/nucleus-ssr/cli`: what `nucleus-ssr.mjs` runs, the `nucleus-ssr`
 * command and its worker mode. Not an API: call `runPrerender()` from code.
 * Node only.
 */
export { main, serveWorker } from "./src/cli";
