/**
 * The server entry defines every Nucleus Kit element except the ones that
 * read the device or the person, so a prerender never upgrades those, and
 * exports the hooks a prerender runs around each page.
 */
import * as server from "../../server";
import { PROGRESSIVE_TAGS } from "../../nucleus-kit.progressive";
import { describe, expect, it } from "@excom/nucleus-test";
import { settle } from "@excom/quark-sheet/server";
import { afterRender, beforeRender } from "@excom/spa-route/server";

const { SERVER_EXCLUDED_TAGS } = server;

describe("nucleus-kit server entry", () => {
  it("defines no excluded element", () => {
    expect(SERVER_EXCLUDED_TAGS.length).toBeGreaterThan(0);
    expect(
      SERVER_EXCLUDED_TAGS.filter((tag) => customElements.get(tag))
    ).toEqual([]);
  });

  it("defines every other Nucleus Kit element", () => {
    const rest = PROGRESSIVE_TAGS.filter(
      (tag) => !SERVER_EXCLUDED_TAGS.includes(tag)
    );
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.filter((tag) => !customElements.get(tag))).toEqual([]);
  });

  it("excludes only tags Nucleus Kit defines", () => {
    expect(
      SERVER_EXCLUDED_TAGS.filter((tag) => !PROGRESSIVE_TAGS.includes(tag))
    ).toEqual([]);
  });

  it("is a complete prerender entry: the router's hooks and the sheets'", () => {
    expect(server).toMatchObject({ beforeRender, settle, afterRender });
  });
});
