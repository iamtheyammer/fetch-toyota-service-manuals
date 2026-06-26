import { mkdir } from "fs/promises";
import { join } from "path";
import { Page } from "playwright";
import { TIS_ORIGIN } from "../api/client";
import { ParsedToC } from "./parseToC";
import { isLoginRedirectUrl, SessionExpiredError } from "../api/session";
import { isAlreadyDownloaded, MIN_VALID_PDF_BYTES } from "../api/files";
import { sanitizeName } from "../manual/toc";

/**
 * Download a modern manual whose pages are HTML documents, rendering each to a
 * PDF with Playwright. The (already fetched and saved) parsed ToC is supplied
 * by the caller; see `fetchAndSaveToc`.
 */
export default async function downloadGenericManual(
  page: Page,
  toc: ParsedToC,
  path: string
) {
  console.log("Downloading full manual...");
  await recursivelyDownloadManual(page, path, toc);
}

async function recursivelyDownloadManual(
  page: Page,
  path: string,
  toc: ParsedToC
) {
  for (const [name, value] of Object.entries(toc)) {
    if (typeof value === "string") {
      const sanitizedName = sanitizeName(name);
      const pdfPath = `${join(path, sanitizedName)}.pdf`;

      // Resume support: skip pages already downloaded in a previous run.
      if (isAlreadyDownloaded(pdfPath, MIN_VALID_PDF_BYTES)) {
        continue;
      }

      console.log(`Downloading page ${sanitizedName}...`);
      try {
        await page.goto(`${TIS_ORIGIN}${value}`, { waitUntil: "load" });
        // If the session expired, TIS redirects to the login page (HTTP 200)
        // instead of the document. Abort rather than save a login page as a PDF.
        if (isLoginRedirectUrl(page.url())) {
          throw new SessionExpiredError();
        }
        await page.addScriptTag({
          content: `document.querySelector(".footer").remove()`,
        });
        await page.pdf({
          path: pdfPath,
          margin: { top: 1, right: 1, bottom: 1, left: 1 },
        });
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
    await recursivelyDownloadManual(page, branchPath, value);
  }
}
