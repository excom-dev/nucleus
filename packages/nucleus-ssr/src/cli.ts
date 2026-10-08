import { builtin, cwd, env } from "./node";
import {
  CONFIG_ENV,
  InputError,
  loadPrerenderConfig,
  type RunOptions,
  runPrerender,
} from "./run";
import { serveRenderer } from "./worker";

const USAGE =
  "Usage: nucleus-ssr <config> [--concurrency <n>] [--no-cache] [--save-shell <file>]";

const HELP = `${USAGE}

Prerenders every route of a built site. <config> default-exports the
prerender() options, or a function returning them; relative root, out and
cache.dir in it are its own folder's, and out is root when it names none.
Exits 1 when a page failed, a route has no file or a link leads to no page.

  --concurrency <n>    workers rendering at once (default: one per core but one, at most 6)
  --no-cache           neither read nor write the cache the config names
  --save-shell <file>  save the shell the pages rendered from
  -h, --help           print this help`;

/** A mistake on the command line: printed with the usage line. */
class UsageError extends InputError {}

/** The command line as `runPrerender()` options, or `"help"`. */
export const parseArguments = (args: string[]): RunOptions | "help" => {
  const parse = () => {
    try {
      return builtin("node:util").parseArgs({
        args,
        allowPositionals: true,
        allowNegative: true,
        options: {
          concurrency: { type: "string" },
          cache: { type: "boolean", default: true },
          "save-shell": { type: "string" },
          help: { type: "boolean", short: "h" },
        },
      });
    } catch (error) {
      // Node's first sentence: "Unknown option '--watch'"
      throw new UsageError(
        `nucleus-ssr: ${(error as Error).message.split(". ")[0]}`
      );
    }
  };
  const { values, positionals } = parse();
  if (values.help) return "help";
  if (positionals.length !== 1)
    throw new UsageError(
      positionals.length
        ? `nucleus-ssr: one config only, not ${positionals.join(" ")}`
        : "nucleus-ssr: no config module given"
    );
  const concurrency =
    values.concurrency === undefined ? undefined : Number(values.concurrency);
  if (
    concurrency !== undefined &&
    (!Number.isInteger(concurrency) || concurrency < 1)
  )
    throw new UsageError(
      `nucleus-ssr: --concurrency takes a whole number above 0, not ${values.concurrency}`
    );
  return {
    config: positionals[0]!,
    concurrency,
    cache: values.cache ? undefined : false,
    shellFile: values["save-shell"] as string | undefined,
  };
};

/**
 * `nucleus-ssr <config> [--concurrency <n>] [--no-cache] [--save-shell <file>]`:
 * `runPrerender()` from the command line, resolving to its exit code. A
 * mistake in the arguments or the config prints one line to stderr and
 * resolves to 1. `worker` replaces the command's own worker mode. Exists
 * for the command (`nucleus-ssr.mjs`): call `runPrerender()` from code.
 */
export async function main(
  args: string[],
  { worker }: Pick<RunOptions, "worker"> = {}
): Promise<number> {
  try {
    const options = parseArguments(args);
    if (options === "help") {
      console.log(HELP);
      return 0;
    }
    const file = builtin("node:path").resolve(cwd(), options.config);
    if (!builtin("node:fs").existsSync(file))
      throw new UsageError(`nucleus-ssr: no config at ${file}`);
    const { exitCode } = await runPrerender({ ...options, worker });
    return exitCode;
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    console.error(
      error instanceof UsageError ? `${error.message}\n${USAGE}` : error.message
    );
    return 1;
  }
}

/**
 * The command in a worker its own run forked: loads the run's config (its
 * environment's `NUCLEUS_SSR_CONFIG`) with Node's `import()` and serves its
 * renderer. Exists for the command (`nucleus-ssr.mjs`), not as an API.
 */
export async function serveWorker(): Promise<void> {
  await serveRenderer(await loadPrerenderConfig(env(CONFIG_ENV)!));
}
