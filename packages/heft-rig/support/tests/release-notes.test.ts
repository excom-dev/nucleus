import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { readReleaseNotes } from "../../scripts/release-notes.mjs";
import { changelogJson, makeTempDir, removeDir, writeFiles } from "./docs-pipeline-fixtures";

describe("readReleaseNotes", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = makeTempDir("heft-rig-release-notes-");
  });
  afterAll(() => removeDir(tmp));

  const read = async (name: string, changelog?: string) => {
    const root = path.join(tmp, name);
    writeFiles(root, changelog === undefined ? { "package.json": "{}" } : { "CHANGELOG.json": changelog });
    return readReleaseNotes(root, `@excom/${name}`);
  };

  it("drops dependency / none noise and duplicates, and lists major first, hotfix last", async () => {
    const name = "@excom/noted-lib";
    expect(
      await read(
        "noted-lib",
        changelogJson(name, [
          {
            version: "0.2.0",
            comments: {
              hotfix: ["Revert `parse()`"],
              patch: ["Fix a crash", "Fix a crash"],
              dependency: ["Bump `@excom/other` to 9.9.9"],
              minor: ["Add `newApi()`"],
              none: ["Tidy internals"],
              major: ["Remove `oldApi()`"],
            },
          },
        ]),
      ),
    ).toEqual([
      {
        version: "0.2.0",
        day: "2026-09-30",
        notes: ["Remove `oldApi()`", "Add `newApi()`", "Fix a crash", "Revert `parse()`"],
      },
    ]);
  });

  it("drops releases left without notes, keeps the rest newest first and dates them in UTC", async () => {
    const name = "@excom/ordered-notes";
    const releases = await read(
      "ordered-notes",
      changelogJson(name, [
        {
          version: "0.5.0",
          date: "Fri, 02 Oct 2026 00:00:30 GMT",
          comments: { patch: ["Fix `x`"] },
        },
        {
          version: "0.4.0",
          date: "Thu, 01 Oct 2026 23:59:59 GMT",
          comments: { hotfix: ["Fix `x`"] },
        },
        { version: "0.3.1", comments: { dependency: ["Bump `@excom/other`"], none: ["Tidy"] } },
        { version: "0.3.0", comments: {} },
        { version: "0.2.0", comments: { minor: ["Fix `x`"] } },
      ]),
    );
    expect(releases.map(({ version, day }) => [version, day])).toEqual([
      ["0.5.0", "2026-10-02"],
      ["0.4.0", "2026-10-01"],
      ["0.2.0", "2026-09-30"],
    ]);
  });

  it("keeps only non-empty string comments", async () => {
    const releases = await read(
      "odd-comments",
      JSON.stringify({
        name: "@excom/odd-comments",
        entries: [
          { version: "0.2.0", comments: { minor: [{ comment: "Kept" }, {}, { comment: 5 }, null, { comment: "" }, { comment: "  " }] } },
          { version: "0.1.0", comments: { patch: [{}, { comment: null }] } },
        ],
      }),
    );
    expect(releases).toEqual([{ version: "0.2.0", day: "", notes: ["Kept"] }]);
  });

  it("gives an empty day when a release has no date or an unparsable one", async () => {
    const name = "@excom/undated-notes";
    const comments = (comment: string) => ({ minor: [{ comment }] });
    const releases = await read(
      "undated-notes",
      JSON.stringify({
        name,
        entries: [
          { version: "0.3.0", comments: comments("Missing") },
          { version: "0.2.0", date: null, comments: comments("Null") },
          { version: "0.1.0", date: "soon", comments: comments("Garbage") },
        ],
      }),
    );
    expect(releases.map(({ version, day }) => [version, day])).toEqual([
      ["0.3.0", ""],
      ["0.2.0", ""],
      ["0.1.0", ""],
    ]);
  });

  it("is empty without CHANGELOG.json, without entries, or when nothing survives", async () => {
    expect(await read("no-changelog")).toEqual([]);
    expect(await read("no-entries", JSON.stringify({ name: "@excom/no-entries" }))).toEqual([]);
    expect(
      await read(
        "noise-only",
        changelogJson("@excom/noise-only", [{ version: "0.1.1", comments: { dependency: ["Bump `@excom/other`"] } }]),
      ),
    ).toEqual([]);
  });

  it("names the package and CHANGELOG.json when the file is malformed", async () => {
    await expect(
      read("broken-notes", `{ "name": "@excom/broken-notes", "entries": [{ "version": "0.1.0"`),
    ).rejects.toThrow(/@excom\/broken-notes: invalid CHANGELOG\.json/);
  });
});
