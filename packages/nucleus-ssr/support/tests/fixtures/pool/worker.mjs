// A pool worker for the tests: the package's source through the rig's
// module runner, as heft-rig's prerender worker loads a site's.
import { createWorkspaceRunner } from "@excom/heft-rig/scripts/prerender.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runner = await createWorkspaceRunner(join(here, "../../../.."));
await runner.import(join(here, "worker.ts"));
