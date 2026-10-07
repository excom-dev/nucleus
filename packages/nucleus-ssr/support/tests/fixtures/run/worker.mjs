// The command in worker mode for the tests: `cli.ts` from source through the
// rig's module runner, where the built `nucleus-ssr.mjs` imports `dist/cli.js`.
import { createWorkspaceRunner } from "@excom/heft-rig/scripts/prerender.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const runner = await createWorkspaceRunner(root);
const { serveWorker } = await runner.import(join(root, "cli.ts"));
await serveWorker();
