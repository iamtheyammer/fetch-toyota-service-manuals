import { AxiosResponse } from "axios";
import { client } from "../api/client";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import parseToC, { ParsedToC } from "./parseToC";
import { Page } from "playwright";
import { existsSync } from "fs";
import { Manual } from "..";
import sanitizeFilename from "../sanitizeFilename";

export default async function downloadGenericManual(
  page: Page,
  manualData: Manual,
  path: string
) {
  // download ToC
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
      `Unknown error getting title XML for manual ${manualData.raw}: ${e}`
    );
  }

  const files = parseToC(tocReq.data, manualData.year);

  // write to disk
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

  console.log("Downloading full manual...");
  await recursivelyDownloadManual(page, path, files);
}

async function recursivelyDownloadManual(
  page: Page,
  path: string,
  toc: ParsedToC
) {
  const exploded = Object.entries(toc);

  for (const explIdx in exploded) {
    const [name, value] = exploded[explIdx];

    if (typeof value === "string") {
      const sanitizedName = sanitizeFilename(name);
      const sanitizedPath = `${join(path, sanitizedName)}.pdf`;

      // Skip pages we already have so re-running only fetches what's missing.
      if (existsSync(sanitizedPath)) {
        continue;
      }

      console.log(`Downloading page ${sanitizedName}...`);

      // download page
      try {
        await page.goto(`https://techinfo.toyota.com${value}`, {
          waitUntil: "load",
        });
        await page.addScriptTag({
          content: `document.querySelector(".footer").remove()`,
        });
        await page.pdf({
          path: sanitizedPath,
          margin: {
            top: 1,
            right: 1,
            bottom: 1,
            left: 1,
          },
        });
      } catch (e) {
        console.error(`Error saving page ${name}: ${e}`);
        continue;
      }

      // downloaded page, move on
      continue;
    }

    // we're not at the bottom of the tree, continue

    // create folder
    const newPath = join(path, sanitizeFilename(name));
    if (newPath.includes("undefined")) debugger;
    try {
      await mkdir(newPath, { recursive: true });
    } catch (e) {
      if ((e as any).code === "EEXIST") {
        console.log(
          `Not creating folder ${newPath} because it already exists.`
        );
      }
    }

    await recursivelyDownloadManual(page, newPath, value);
  }
}
