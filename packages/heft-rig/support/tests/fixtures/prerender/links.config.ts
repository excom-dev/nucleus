import { options } from "./options";

/** Only `/`: the shell's link to `/broken` leads to no page. */
export default { ...options(), routes: ["/"] };
