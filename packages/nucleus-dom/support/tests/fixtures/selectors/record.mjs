// Records what Chrome answers for the selector cases next to this file: the ground truth that
// selectors.test.ts holds the shims to. Run from the package directory after adding a case, then keep
// the answers it writes:
//
//   node support/tests/fixtures/selectors/record.mjs
//
// cases.json runs against index.html and cases2.json against index2.html (answers in chrome.json and
// chrome2.json); each dynamic.json case runs in a fresh container on blank.html (chrome-dynamic.json).
// It needs Google Chrome (or CHROME) and cannot run in a sandbox. The owner approves every run, as for
// the wrenfield suite (whose Chrome harness this reuses).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { open, serve } from "../../../../../wrenfield/support/tests/browser/shot.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file) => JSON.parse(readFileSync(`${here}${file}`, "utf8"));
const write = (file, answers) => writeFileSync(`${here}${file}`, `${JSON.stringify(answers, null, 1)}\n`);

// In the page: ids in document order, a boolean, an id or null, or the error's name.
const answerStatic = (cases) => {
  const ids = (list) => [...list].map((element) => element.id || `<${element.localName}>`);
  const attempt = (answer) => {
    try {
      return answer();
    } catch (error) {
      return `THROW ${error.name}`;
    }
  };
  const root = (selector) => document.querySelector(selector);
  return {
    browser: navigator.userAgent,
    all: cases.all.map((selector) => [selector, attempt(() => ids(document.querySelectorAll(selector)))]),
    scoped: cases.scoped.map(([from, selector]) => [
      from,
      selector,
      attempt(() => ids(root(from).querySelectorAll(selector))),
    ]),
    matches: cases.matches.map(([element, selector]) => [
      element,
      selector,
      attempt(() => root(element).matches(selector)),
    ]),
    closest: cases.closest.map(([element, selector]) => [
      element,
      selector,
      attempt(() => root(element).closest(selector)?.id ?? null),
    ]),
  };
};

// In the page: each case's `code` is a function body that receives its container as `root`.
const answerDynamic = (cases) => ({
  browser: navigator.userAgent,
  answers: cases.map(({ name, html, code }) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.append(root);
    try {
      return [name, new Function("root", code)(root)];
    } catch (error) {
      return [name, `THROW ${error.name}: ${String(error.message).slice(0, 80)}`];
    } finally {
      root.remove();
    }
  }),
});

const server = await serve({ root: here });
const page = await open({ port: server.port, size: "1280x800", settle: 100 }).catch((error) => {
  console.log(`Chrome did not start: ${error.message}. It needs Google Chrome (or CHROME) and no sandbox.`);
  process.exit(1);
});
const RECORDINGS = [
  ["index.html", "cases.json", "chrome.json", answerStatic],
  ["index2.html", "cases2.json", "chrome2.json", answerStatic],
  ["blank.html", "dynamic.json", "chrome-dynamic.json", answerDynamic],
];
for (const [fixture, cases, answers, answer] of RECORDINGS) {
  await page.goto(`/${fixture}`);
  write(answers, await page.run(answer, read(cases)));
  console.log(`${answers}: recorded from ${fixture}`);
}
await page.close();
server.close();
