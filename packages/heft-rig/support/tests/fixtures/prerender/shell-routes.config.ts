import { options } from "./options";

/** `/broken` written as the shell, never rendered: `/` links a page that has a file. */
export default { ...options(), routes: ["/"], shellRoutes: ["/broken"] };
