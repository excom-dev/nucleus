import "@excom/dialog-anchor";
import "@excom/quark-sheet";
import "@excom/spa-route";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  bypassSelectorCache,
  flush,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(
  import.meta.url,
  "../../public/views/not-found/not-found.html",
);
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/not-found/not-found.quark",
);

const stripAssets = (s: string) =>
  s.replace(/<link[\s\S]*?>/g, "").replace(/\s+src-url="[^"]*"/g, "");

/**
 * Mount the view under a stand-in for the shell: the `is-fallback` route, whose
 * provision carries the `.*` match, plus the sheet publishing `$route`.
 */
const mountView = async (pathname: string) => {
  const host = document.createElement("div");
  host.innerHTML = `<quark-sheet>spa-route { $route: prop("provision"); }</quark-sheet><spa-route></spa-route>`;
  const route = host.querySelector<HTMLElement & { provision: unknown }>(
    "spa-route",
  )!;
  route.provision = { match: pathname.match(/.*/), params: null };
  route.innerHTML = stripAssets(html);
  const sheet = route.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
  sheet.textContent = quarkSrc;
  document.body.append(host);
  if (!sheet.quarkInstance) await waitForEvent(sheet, "quark-sheet-success");
  await flush();
  return route.querySelector<HTMLElement>("#not-found")!;
};

describe("not-found view", () => {
  beforeEach(bypassSelectorCache);

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names the path that matched nothing and offers a way out", async () => {
    const page = await mountView("/nope");

    expect(page.querySelector("h1")?.textContent).toBe("Page not found");
    expect(page.querySelector("[bind-path]")?.textContent).toBe("/nope");
    expect(
      [...page.querySelectorAll("nav spa-a")].map((a) =>
        a.getAttribute("route-href"),
      ),
    ).toEqual(["/nucleus", "/nucleus/docs/quick_start"]);
    expect(
      page.querySelector("nav dialog-anchor")?.getAttribute("target-ref"),
    ).toBe("#search-dialog");
  });

  it("reads the path from the route, not the location", async () => {
    const page = await mountView("/nucleus/docs/introduction");

    expect(page.querySelector("[bind-path]")?.textContent).toBe(
      "/nucleus/docs/introduction",
    );
  });
});
