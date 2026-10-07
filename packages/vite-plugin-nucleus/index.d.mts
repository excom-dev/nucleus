import type { Plugin, UserConfig } from "vite";

export interface NucleusOptions {
  /**
   * Where a build takes the Nucleus Kit from: bundled from the installed
   * package, or loaded from unpkg at its installed version (deploy builds).
   * @default "bundled"
   */
  kit?: "bundled" | "unpkg";
}

/**
 * The Vite plugin of a Nucleus Stack site: `plugins: [nucleus()]`. Builds every
 * page at the root with its Quark modules and service worker, serves them in
 * dev, and previews the build as Cloudflare Workers static assets serve it.
 *
 * It sets the build's inputs and file names (modules unhashed at their URL) and
 * the PostCSS chain: a PostCSS config file is not read, more PostCSS plugins go
 * in `css.postcss.plugins`. `publicDir`, `build.outDir`, `build.emptyOutDir` and
 * `build.assetsDir` stay the app's. The site is read once per config
 * resolution: a page or module added while dev runs needs a restart.
 */
export function nucleus(options?: NucleusOptions): Plugin[];

/** The Vite config of the site at `root` for `command`: what `nucleus()` contributes, with its plugins for that command. */
export function siteConfig(
  options: NucleusOptions & { command: "build" | "serve" | "preview"; root: string },
): Promise<UserConfig>;

/**
 * What the site at `root` holds: its pages and Quark modules by name
 * (`{ shell: "<root>/shell.ts" }`), and its service worker. `publicDir`: the
 * files served as they are (default `<root>/public`, `false` for none). Rejects
 * when two files would answer at one URL.
 */
export function layoutOf(root: string, publicDir?: string | false): Promise<{
  pages: Record<string, string>;
  modules: Record<string, string>;
  serviceWorker: string | undefined;
}>;
