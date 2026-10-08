import "@excom/quark-sheet";
import "@excom/spa-route";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  readFileRelative,
  waitForEvent,
} from "@excom/nucleus-test";
import { Quark } from "@excom/quark";
import { flush } from "@excom/quark/support/tests/view-helpers";
import {
  addLengths,
  buildGitHubLink,
  fileNameOf,
  formatTsType,
  joinSelectors,
  pickDefault,
  sumLengths,
  unescapeCssType,
  unescapeHtml,
} from "../../shell";

const html = readFileRelative(
  import.meta.url,
  "../../public/views/api-reference/api-reference.html",
);
const quarkSrc = readFileRelative(
  import.meta.url,
  "../../public/views/api-reference/api-reference.quark",
);

/** The pure helpers of `@use "/shell"`; the real module boots Shiki. */
const shellStub = {
  addLengths,
  buildGitHubLink,
  fileNameOf,
  formatTsType,
  joinSelectors,
  pickDefault,
  sumLengths,
  unescapeCssType,
  unescapeHtml,
};

const releases = [
  {
    version: "1.1.0",
    day: "2026-10-01",
    notesHtml: ["Add <code>newApi()</code>", "Fix a <em>crash</em>"],
  },
  { version: "1.0.0", day: "", notesHtml: ["First release"] },
];

const element = {
  tag: "x-thing",
  attributes: [],
  provisions: [],
  events: [],
  listens: [],
  commands: [],
  expectedChildren: [],
  cssClasses: [],
  cssProperties: [],
  cssAliases: [],
};

const stripAssets = (s: string) =>
  s.replace(/<link[\s\S]*?>/g, "").replace(/\s+src-url="[^"]*"/g, "");

/**
 * Mount the view under a stand-in for the package view: a `spa-route`
 * whose `provision` is published as `$package-meta` / `$package-name`.
 */
const mountView = async (meta: Record<string, unknown>) => {
  const host = document.createElement("div");
  host.innerHTML = `<quark-sheet>spa-route { $package-meta: prop("provision"); $package-name: "x-lib"; }</quark-sheet><spa-route></spa-route>`;
  const route = host.querySelector<HTMLElement & { provision: unknown }>(
    "spa-route",
  )!;
  route.provision = meta;
  route.innerHTML = stripAssets(html);
  const sheet = route.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
  sheet.textContent = quarkSrc;
  document.body.append(host);
  if (!sheet.quarkInstance) await waitForEvent(sheet, "quark-sheet-success");
  await flush();
  await flush();
  return route;
};

const originalLoader = Quark.moduleLoader;

describe("api-reference view release notes", () => {
  beforeEach(() => {
    Quark.moduleLoader = async (url: string) => {
      if (url.includes("shell")) return shellStub;
      throw new Error(`unexpected @use module: ${url}`);
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Quark.moduleLoader = originalLoader;
  });

  it("ends with one closed Release notes dropdown after the element tables", async () => {
    const route = await mountView({ elementApis: [element, element], releases });

    expect(route.querySelectorAll("#api-reference > article")).toHaveLength(2);
    const dropdowns = route.querySelectorAll<HTMLDetailsElement>("details.accordion");
    const notes = dropdowns[dropdowns.length - 1];
    expect(notes.matches("[bind-releases] > article.nested > details.accordion")).toBe(true);
    expect(notes.open).toBe(false);
    // after the elements' own dropdowns, in a card of its own
    expect(notes.closest("#api-reference")).toBeNull();
    expect(
      route.querySelector("#api-reference")!.compareDocumentPosition(notes) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(route.querySelectorAll("[bind-releases] details")).toHaveLength(1);
    expect(notes.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Release notes (2)",
    );
  });

  it("lists a heading with the version and day and the notes per release, in meta order", async () => {
    const route = await mountView({ elementApis: [], releases });

    const sections = route.querySelectorAll("[bind-release-list] > section");
    expect([...sections].map((s) => s.querySelector("h3 [bind-version]")?.textContent)).toEqual([
      "1.1.0",
      "1.0.0",
    ]);
    const time = sections[0].querySelector("h3 time")!;
    expect(time.textContent).toBe("2026-10-01");
    expect(time.getAttribute("datetime")).toBe("2026-10-01");
    expect([...sections[0].querySelectorAll("ul > li")].map((li) => li.innerHTML)).toEqual([
      "Add <code>newApi()</code>",
      "Fix a <em>crash</em>",
    ]);
    expect([...sections[1].querySelectorAll("li")].map((li) => li.innerHTML)).toEqual([
      "First release",
    ]);
    // a release without a day paints an empty time the sheet hides
    expect(sections[1].querySelector("time")?.textContent).toBe("");
  });

  it("renders the dropdown for a package with no elements, and no empty article", async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
    window.addEventListener("error", onError);
    const route = await mountView({ elementApis: [], releases });
    window.removeEventListener("error", onError);

    expect(route.querySelectorAll("#api-reference > article")).toHaveLength(0);
    expect(route.querySelectorAll("details.accordion")).toHaveLength(1);
    expect(route.querySelector("details.accordion summary")?.textContent).toContain(
      "Release notes",
    );
    expect(errors).toEqual([]);
  });

  it.each([
    ["has no releases key", { elementApis: [element] }],
    ["has an empty list", { elementApis: [element], releases: [] }],
  ])("renders no release notes when the meta %s", async (_label, meta) => {
    const route = await mountView(meta);

    expect(route.querySelectorAll("#api-reference > article")).toHaveLength(1);
    expect(route.querySelector("[bind-releases]")?.children).toHaveLength(0);
    expect(route.textContent).not.toContain("Release notes");
  });
});
