import { AxiosResponse } from "axios";
import { writeFile } from "fs/promises";
import { join } from "path";
import { client } from "../api/client";
import parseToC, { ParsedToC } from "../genericManual/parseToC";
import { looksLikeLoginPage, SessionExpiredError } from "../api/session";
import { Manual } from "..";

/**
 * Shared table-of-contents handling for both the modern (HTML) and legacy (PDF)
 * manual downloaders. Centralizing it keeps the ToC fetch, the friendly
 * "doesn't exist" 404 message, and the (non-obvious) `toc.js` serialization in
 * a single place, and lets the manual be fetched once per run rather than once
 * per detection plus once per download.
 */

/** Make a ToC entry name safe to use as a single file/directory path segment. */
export function sanitizeName(name: string): string {
  return name.replace(/\//g, "-");
}

/**
 * Fetch a manual's table of contents, persist it (`toc-full.xml`,
 * `toc-downloaded.json`, and `toc.js` for the Manual Locator), and return the
 * parsed, year-filtered tree.
 *
 * @throws a friendly error if the manual ID doesn't exist (HTTP 404).
 * @throws {SessionExpiredError} if the ToC endpoint returns a login page.
 */
export async function fetchAndSaveToc(
  manualData: Manual,
  path: string
): Promise<ParsedToC> {
  let tocReq: AxiosResponse;
  try {
    console.log("Downloading table of contents...");
    tocReq = await client({
      method: "GET",
      url: `${manualData.type}/${manualData.id}/toc.xml`,
      // we don't want axios to parse this
      responseType: "text",
    });
  } catch (e: any) {
    if (e.response && e.response.status === 404) {
      throw new Error(
        `Manual ${manualData.id} doesn't appear to exist-- are you sure the ID is right?`
      );
    }
    throw new Error(
      `Unknown error getting table of contents for ${manualData.raw}: ${e}`
    );
  }

  // The ToC is XML; an HTML response means TIS bounced us to the login page.
  if (looksLikeLoginPage(tocReq.data)) {
    throw new SessionExpiredError();
  }

  const files = parseToC(tocReq.data, manualData.year);

  console.log("Saving table of contents...");
  await Promise.all([
    writeFile(join(path, "toc-full.xml"), tocReq.data),
    writeFile(
      join(path, "toc-downloaded.json"),
      JSON.stringify(files, null, 2)
    ),
    writeFile(
      join(path, "toc.js"),
      `document.toc = JSON.parse(\`${JSON.stringify(files).replaceAll(
        '\\"',
        ""
      )}\`);`
    ),
  ]);

  return files;
}
