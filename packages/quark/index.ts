// Main entry point for @excom/quark package
export type { QuarkElementApi } from "./src/element-api";
export { Quark } from "./src/quark";
/** The logger Quark uses: `QuarkLogger.level = 2` shows warnings. */
export * as QuarkTypes from "./src/types";
export { QuarkLogger } from "./src/utils";
