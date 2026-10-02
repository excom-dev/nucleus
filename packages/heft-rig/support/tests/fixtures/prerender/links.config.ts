import { options } from "./options";

/** Only `/`: the shell's link to `/nucleus/broken` leads to no page. */
export default { ...options(), routes: ["/"] };
