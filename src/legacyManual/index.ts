import { mkdir } from "fs/promises";
import { join } from "path";
import { client, TIS_ORIGIN } from "../api/client";
import { ParsedToC } from "../genericManual/parseToC";
import saveStream from "../api/saveStream";
import { looksLikeSessionLost, SessionExpiredError } from "../api/session";
import { isAlreadyDownloaded, MIN_VALID_PDF_BYTES } from "../api/files";
import { sanitizeName } from "../manual/toc";

/**
 * Older TIS manuals (e.g. the 2002-era repair manuals and `EWD###U` wiring
 * diagrams) use the generic `toc.xml` tree, but each leaf "page" is a thin
 * xhtml wrapper that redirects to a real, downloadable PDF -- unlike modern
 * manuals whose pages are HTML rendered to PDF with Playwright. This module
 * downloads those PDFs directly over HTTP (no browser required).
 */

// Every legacy document URL (xhtml wrapper and PDF alike) must carry this query
// suffix; without it the server returns a client-side locale/siid bootstrap
// redirect instead of the terminal content.
const DOC_SUFFIX = "?sisuffix=ff&locale=en";

/**
 * True if a manual is the legacy PDF-wrapper format (each leaf links to a
 * downloadable PDF) rather than the modern HTML-rendered format. Detected by
 * sampling the manual's first leaf page.
 *
 * @throws {SessionExpiredError} if the sampled page is a session-loss page.
 */
export async function isLegacyPdfManual(toc: ParsedToC): Promise<boolean> {
  const firstHref = firstLeafHref(toc);
  if (!firstHref) return false;

  const wrapper = await client({
    method: "GET",
    url: `${TIS_ORIGIN}${firstHref}${DOC_SUFFIX}`,
    responseType: "text",
  });
  const html = String(wrapper.data);
  if (extractPdfHref(html) !== undefined) return true;

  // No PDF link: either a modern HTML page, or the session was lost mid-detect.
  if (looksLikeSessionLost(html)) throw new SessionExpiredError();
  return false;
}

/**
 * Download a legacy manual by fetching each page's linked PDF directly. The
 * (already fetched and saved) parsed ToC is supplied by the caller; see
 * `fetchAndSaveToc`.
 */
export default async function downloadLegacyManual(
  toc: ParsedToC,
  path: string
) {
  console.log("Downloading full manual (legacy PDF format)...");
  await recursivelyDownloadLegacyManual(path, toc);
}

/**
 * Fetch a single legacy document's xhtml wrapper, follow the PDF link it
 * contains, and save that PDF to pdfPath. Shared by the legacy-manual
 * downloader (one call per ToC leaf) and the standalone document downloader
 * (`tools/downloadDocuments.ts`, one call per TSB/bulletin), which serve PDFs
 * through the identical wrapper mechanism. The caller owns skip-existing and
 * logging so it can tally outcomes as it sees fit.
 *
 * @returns true if a PDF was saved, false if the wrapper had no PDF link.
 * @throws {SessionExpiredError} if the wrapper is a session-loss page.
 */
export async function downloadLegacyDocumentPdf(
  wrapperHref: string,
  pdfPath: string
): Promise<boolean> {
  // 1. Fetch the xhtml wrapper to discover the PDF it points to. The wrapper is
  //    legitimately HTML, so detect session loss with the precise check rather
  //    than the generic "is this HTML?" one.
  const wrapper = await client({
    method: "GET",
    url: `${TIS_ORIGIN}${wrapperHref}${DOC_SUFFIX}`,
    responseType: "text",
  });

  const pdfHref = extractPdfHref(String(wrapper.data));
  if (!pdfHref) {
    if (looksLikeSessionLost(String(wrapper.data))) {
      throw new SessionExpiredError();
    }
    return false;
  }

  // 2. Download the PDF itself.
  const pdfReq = await client({
    method: "GET",
    url: `${TIS_ORIGIN}${pdfHref}${DOC_SUFFIX}`,
    responseType: "stream",
  });
  await saveStream(pdfReq.data, pdfPath);
  return true;
}

async function recursivelyDownloadLegacyManual(path: string, toc: ParsedToC) {
  for (const [name, value] of Object.entries(toc)) {
    if (typeof value === "string") {
      const pdfPath = `${join(path, sanitizeName(name))}.pdf`;

      // Resume support: skip pages already downloaded in a previous run.
      if (isAlreadyDownloaded(pdfPath, MIN_VALID_PDF_BYTES)) {
        continue;
      }

      console.log(`Downloading page ${sanitizeName(name)}...`);
      try {
        const saved = await downloadLegacyDocumentPdf(value, pdfPath);
        if (!saved) {
          console.error(`No PDF link found for page ${name}, skipping.`);
        }
      } catch (e) {
        // A session expiry is fatal for the whole run; let it propagate.
        if (e instanceof SessionExpiredError) throw e;
        console.error(`Error saving page ${name}: ${e}`);
      }

      continue;
    }

    // Not a leaf: recurse into the sub-tree.
    const branchPath = join(path, sanitizeName(name));
    await mkdir(branchPath, { recursive: true });
    await recursivelyDownloadLegacyManual(branchPath, value);
  }
}

/**
 * Extract the PDF URL that a legacy wrapper page redirects to, from either its
 * `<link rel="pdf" href="...">` element or its `location="....pdf"` script.
 */
function extractPdfHref(html: string): string | undefined {
  const link =
    html.match(/<link[^>]+rel=["']pdf["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']pdf["']/i);
  if (link) return link[1];

  const loc = html.match(/location\s*=\s*["']([^"']+\.pdf[^"']*)["']/i);
  return loc ? loc[1] : undefined;
}

/** Depth-first search for the first leaf (string) value in a parsed ToC. */
function firstLeafHref(toc: ParsedToC): string | undefined {
  for (const value of Object.values(toc)) {
    if (typeof value === "string") return value;
    const nested = firstLeafHref(value);
    if (nested) return nested;
  }
  return undefined;
}
