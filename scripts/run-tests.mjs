import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const testsDir = path.resolve("tests");
const files = (await readdir(testsDir))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

for (const file of files) {
  await import(pathToFileURL(path.join(testsDir, file)));
}
