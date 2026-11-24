import { existsSync } from "fs";
import { resolve, join } from "path";
import { buildAllIndexes } from "./index";

/**
 * `yarn build-index` — (re)generate the offline browser for every already-
 * downloaded manual under ./manuals, with no network or cookie required.
 */
const manualsDir = resolve(join(".", "manuals"));

if (!existsSync(manualsDir)) {
  console.error(`No manuals directory at ${manualsDir}. Download a manual first.`);
  process.exit(1);
}

buildAllIndexes(manualsDir).catch((e) => {
  console.error(e);
  process.exit(1);
});
