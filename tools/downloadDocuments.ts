import commandLineArgs from "command-line-args";
import { join, resolve } from "path";
import { mkdir } from "fs/promises";
import { collectDocuments, FoundDoc, MANUAL_OBJ_TYPES } from "./lookupCodes";
import { resolveCookieString } from "./lib/harCookie";
import { setCookieStringOnJar } from "../src/api/cookies";
import { downloadLegacyDocumentPdf } from "../src/legacyManual";
import { isAlreadyDownloaded, MIN_VALID_PDF_BYTES } from "../src/api/files";
import { sanitizeName } from "../src/manual/toc";
import { SessionExpiredError } from "../src/api/session";

/**
 * Download every standalone document (TSB, recall/campaign bulletin, diagnostic
 * info, quick-training guide, …) that TIS lists for a vehicle. These are NOT the
 * multi-page manuals handled by the main downloader (`yarn start`): each is a
 * single document served as an xhtml wrapper that redirects to one PDF -- the
 * same mechanism as a legacy manual leaf, but with no ToC. We reuse the catalog
 * scraper from lookupCodes to enumerate them and the legacy PDF fetcher to save
 * each one. Multi-page manual publications (MANUAL_OBJ_TYPES) are skipped --
 * fetch those with the main downloader (`yarn start -m <type>:<id>`).
 *
 * Usage:
 *   TIS_COOKIE='...' ts-node tools/downloadDocuments.ts --model Highlander --year 2002
 *   ts-node tools/downloadDocuments.ts --model Highlander --year 2002 --har ~/Downloads/techinfo.har
 *
 * Files are written to `<out>/<objType>/<publicationNumber>.pdf` (default out:
 * ./manuals/_documents).
 */

/** The xhtml wrapper href for a standalone document, relative to the host. */
function wrapperHref(doc: FoundDoc): string {
  return `/t3Portal/document/${doc.type}/${doc.publicationNumber}/xhtml/${doc.publicationNumber}.html`;
}

async function main() {
  const opts = commandLineArgs([
    { name: "model", type: String },
    { name: "year", type: String },
    { name: "division", type: String, defaultValue: "TOYOTA" },
    { name: "har", type: String },
    {
      name: "out",
      type: String,
      defaultValue: join(".", "manuals", "_documents"),
    },
  ]);

  if (!opts.model || !opts.year) {
    console.error(
      "Usage: ts-node tools/downloadDocuments.ts --model <Model> --year <Year> " +
        "[--division TOYOTA] [--har <har-path>] [--out <dir>]"
    );
    process.exit(2);
  }

  const cookieString = resolveCookieString(opts.har);
  setCookieStringOnJar(cookieString);

  console.log(
    `Looking up documents for ${opts.division} ${opts.model} ${opts.year}...`
  );
  const allDocs = await collectDocuments(
    { division: opts.division, model: opts.model, year: opts.year },
    cookieString
  );

  const docs = allDocs.filter((d) => !MANUAL_OBJ_TYPES.has(d.type));
  const skippedManuals = allDocs.length - docs.length;
  console.log(
    `Found ${allDocs.length} documents; ${docs.length} standalone ` +
      `(skipping ${skippedManuals} multi-page manual publications -- use the main downloader for those).`
  );

  let saved = 0;
  let skipped = 0;
  let noPdf = 0;
  let failed = 0;

  for (const doc of docs) {
    const dir = resolve(opts.out, doc.type);
    await mkdir(dir, { recursive: true });
    const pdfPath = join(dir, `${sanitizeName(doc.publicationNumber)}.pdf`);

    if (isAlreadyDownloaded(pdfPath, MIN_VALID_PDF_BYTES)) {
      skipped++;
      continue;
    }

    console.log(`Downloading ${doc.type}/${doc.publicationNumber}...`);
    try {
      const ok = await downloadLegacyDocumentPdf(wrapperHref(doc), pdfPath);
      if (ok) {
        saved++;
      } else {
        noPdf++;
        console.error(
          `  No PDF link for ${doc.type}/${doc.publicationNumber}.`
        );
      }
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e;
      failed++;
      console.error(`  Error on ${doc.type}/${doc.publicationNumber}: ${e}`);
    }
  }

  console.log(
    `\nDone. saved=${saved} skipped(existing)=${skipped} no-pdf=${noPdf} failed=${failed} ` +
      `(of ${docs.length} standalone documents).`
  );
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  if (e instanceof SessionExpiredError) {
    console.error(`\n${e.message}`);
    process.exit(2);
  }
  console.error("ERROR:", e.message ?? e);
  process.exit(1);
});
