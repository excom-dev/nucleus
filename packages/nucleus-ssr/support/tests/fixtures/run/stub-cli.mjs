// Stands in for the built `cli.ts`: prints each call (and, in a forked
// worker, sends it with the config it got); `main` resolves to 1.
export const main = async (args) => {
  console.log(JSON.stringify(["main", args]));
  return 1;
};

export const serveWorker = async () => {
  console.log(JSON.stringify(["serveWorker"]));
  process.send?.(["serveWorker", process.env.NUCLEUS_SSR_CONFIG]);
};
