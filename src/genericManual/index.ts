import { AxiosResponse } from "axios";
import { client } from "../api/client";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import parseToC, { ParsedToC } from "./parseToC";
import { Page } from "playwright";

export default async function downloadGenericManual(
  page: Page,
  manualId: string,
  path: string
) {
  const doctype = manualId.slice(0, 2).toLowerCase();

  // download ToC
  let tocReq: AxiosResponse;
  try {
    console.log("Downloading table of contents...");
    tocReq = await client({
      method: "GET",
      url: `${doctype}/${manualId}/toc.xml`,
      // we don't want axios to parse this
      responseType: "text",
    });
  } catch (e: any) {
    if (e.response && e.response.status === 404) {
      throw new Error(
        `Manual ${manualId} doesn't appear to exist-- are you sure the ID is right?`
      );
    }

    throw new Error(
      `Unknown error getting title XML for manual ${manualId}: ${e}`
    );
  }

  const files = parseToC(tocReq.data);

  // write to disk
  console.log("Saving table of contents...");
  await Promise.all([
    writeFile(join(path, "toc.xml"), tocReq.data),
    writeFile(join(path, "toc.json"), JSON.stringify(files, null, 2)),
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
      const sanitizedName = name.split(";")[0].replace(/\//g, "-");
      const sanitizedPath = `${join(path, sanitizedName)}.pdf`;
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
    const newPath = join(path, name.replace(/\//g, "-"));
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
