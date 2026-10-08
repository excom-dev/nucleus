/**
 * Type tests of `defineConfig()`. Never run: `types.test.ts` compiles this
 * folder (`tsc --noEmit -p support/tests/types` does the same), and an
 * unused `@ts-expect-error` is an error.
 */
import { defineConfig, type PrerenderConfig } from "../../../index";

const options = {
  root: "dist",
  origin: "https://example.com",
  entry: async () => ({}),
  routes: ["/"],
};

// the object form: every option, typed
export const object: PrerenderConfig = defineConfig({
  ...options,
  notFound: "/404",
  onError: "shell",
  servedElsewhere: (absoluteUrl) => absoluteUrl.endsWith("/api"),
});

// a misspelt option is refused, not ignored
export const misspelt = defineConfig({
  ...options,
  // @ts-expect-error `notfound` is no option: `notFound`
  notfound: "/404",
});

// @ts-expect-error `routes` is missing
export const routeless = defineConfig({ root: "dist", origin: "https://example.com", entry: options.entry });

// the function form keeps its own parameters, and what it returns
const fromSitemap = defineConfig((sitemap = "/") => ({
  ...options,
  routes: [sitemap],
  onError: "shell",
}));
export const routes: readonly string[] = fromSitemap("/menu").routes;

const later = defineConfig(async (sitemap = "/") => ({
  ...options,
  routes: [sitemap],
  onError: (url: string) => (url === "/bag" ? "shell" : "fail"),
}));
export const promised: Promise<PrerenderConfig> = later("/menu");

// @ts-expect-error `notfound` is no option, returned by a function
export const misspeltReturn = defineConfig((sitemap = "/") => ({
  ...options,
  routes: [sitemap],
  notfound: "/404",
}));

// @ts-expect-error `notfound` is no option, in a promise
export const misspeltPromise = defineConfig(async () => ({
  ...options,
  notfound: "/404",
}));

// @ts-expect-error `routes` is missing from what the function returns
export const routelessReturn = defineConfig(() => ({ root: "dist", origin: "https://example.com", entry: options.entry }));
