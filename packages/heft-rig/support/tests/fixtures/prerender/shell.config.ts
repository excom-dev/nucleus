import { options } from "./options";

/** `/broken` falls back to the shell; any other failure fails. */
export default {
  ...options(),
  onError: (url: string) => (url.endsWith("/broken") ? "shell" : "fail"),
};
