#!/usr/bin/env node
// `nucleus-ssr <config> [--concurrency <n>] [--no-cache] [--save-shell <file>]`
// (`cli.ts`, built). A worker when its own run forked it (`forkWorker()`: an
// IPC channel and NUCLEUS_SSR_WORKER=1); NUCLEUS_SSR_CONFIG is then its config.
import { main, serveWorker } from "./dist/cli.js";

if (process.send && process.env.NUCLEUS_SSR_WORKER === "1") await serveWorker();
else process.exitCode = await main(process.argv.slice(2));
