import { existsSync } from "fs";
import { resolve, join } from "path";
import { buildAllIndexes } from "./index";

/**
 * `yarn build-index` — (re)generate the offline browser for every already-
 * downloaded manual under ./manuals, with no network or cookie required.
 *
 * Pass `--relink-pdfs` to additionally rewrite each page's in-document "INFO"
 * links to point at the locally downloaded pages (opens them in Adobe Reader;
 * Chrome/Edge block PDF links to local files, but the offline browser's
 * "References" panel works there regardless). This modifies the PDFs in place.
 */
const manualsDir = resolve(join(".", "manuals"));
const relinkPdfs = process.argv.includes("--relink-pdfs");

if (!existsSync(manualsDir)) {
  console.error(`No manuals directory at ${manualsDir}. Download a manual first.`);
  process.exit(1);
}

buildAllIndexes(manualsDir, { relinkPdfs }).catch((e) => {
  console.error(e);
  process.exit(1);
});
