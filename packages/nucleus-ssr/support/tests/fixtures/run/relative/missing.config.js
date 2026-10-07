/** A root with no shell: the site was never built there. */
export default {
  root: "nowhere",
  out: "nowhere",
  origin: "https://wren.test",
  routes: ["/"],
  entry: () => import("../entry.js"),
};
