/**
 * Release notes from a package's Rush `CHANGELOG.json`: one source for the
 * site (`build-package-metas`) and the Markdown mirror (`build-docs`).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Rush change types worth a reader's time; `dependency` / `none` are noise. */
const RELEASE_NOTE_TYPES = ["major", "minor", "patch", "hotfix"];

/** `Wed, 30 Sep 2026 00:32:38 GMT` → `2026-09-30`; empty when missing or unparsable. */
const releaseDay = (date) => {
  const time = new Date(date ?? NaN);
  return Number.isNaN(+time) ? "" : time.toISOString().slice(0, 10);
};

/**
 * `CHANGELOG.json` → releases in file order (Rush writes the newest first).
 * `notes` are the distinct major/minor/patch/hotfix comments, in that order,
 * as Markdown; a release left with none is dropped. `[]` when the file is
 * absent; an unreadable one throws an error naming the package.
 *
 * @param {string} packageRoot
 * @param {string} name package name, for the error
 * @returns {Promise<Array<{ version: string, day: string, notes: string[] }>>}
 *   `day` is `YYYY-MM-DD`, or `""` when the release has no usable date
 */
export async function readReleaseNotes(packageRoot, name) {
  const file = path.resolve(packageRoot, "CHANGELOG.json");
  if (!existsSync(file)) return [];
  try {
    const { entries = [] } = JSON.parse(await readFile(file, "utf8")) ?? {};
    return entries
      .map(({ version, date, comments }) => ({
        version,
        day: releaseDay(date),
        notes: [
          ...new Set(
            RELEASE_NOTE_TYPES.flatMap((type) =>
              (comments?.[type] ?? [])
                .map((c) => c?.comment)
                .filter((comment) => typeof comment === "string" && comment.trim()),
            ),
          ),
        ],
      }))
      .filter(({ notes }) => notes.length);
  } catch (error) {
    throw new Error(`${name}: invalid CHANGELOG.json (${error.message})`, { cause: error });
  }
}
