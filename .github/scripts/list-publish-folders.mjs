import fs from "node:fs";

const rush = JSON.parse(fs.readFileSync("rush.json", "utf8"));
const folders = (rush.projects || [])
  .filter((project) => project.shouldPublish === true)
  .map((project) => project.projectFolder);

process.stdout.write(folders.join("\n"));
