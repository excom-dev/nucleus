import { options } from "./options.js";

type Policy = "fail" | "shell";

/** `/broken` falls back to the shell and `/bag` is a shell route: every page is written, every link has its page. */
export default () => ({
  ...options(),
  onError: (url: string): Policy => (url.endsWith("/broken") ? "shell" : "fail"),
  shellRoutes: ["/bag"],
});
