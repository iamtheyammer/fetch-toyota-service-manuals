import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { client } from "../api/client";
import { AxiosResponse } from "axios";
import parseTitle from "./parseTitle";
import saveStream from "../api/saveStream";
import { Manual } from "..";
import { looksLikeLoginPage, SessionExpiredError } from "../api/session";
import { isAlreadyDownloaded, MIN_VALID_EWD_FILE_BYTES } from "../api/files";

export default async function downloadEWD(manualData: Manual, path: string) {
  // The content sections an EWD can expose. Not every vehicle has every part
  // (older EWDs lack "intro"/"fuselist"/"connlist"; some lack "overall"), so a
  // 404 on a single part is skipped rather than treated as a fatal "wrong id"
  // error -- that error is only raised if NO part is found at all.
  const parts = [
    "intro",
    "system",
    "routing",
    "fuselist",
    "connlist",
    "overall",
  ];

  let foundAnyPart = false;

  // download
  for (const part of parts) {
    const partPath = join(path, part);

    // download ToC "title"
    let titleReq: AxiosResponse;
    try {
      titleReq = await client({
        method: "GET",
        url: `ewdappu/${manualData.id}/ewd/contents/${part}/title.xml`,
        // we don't want axios to parse this
        responseType: "text",
      });
    } catch (e: any) {
      if (e.response && e.response.status === 404) {
        // This part doesn't exist for this vehicle; skip it.
        continue;
      }

      throw new Error(
        `Unknown error getting title XML for EWD ${manualData.id} part ${part}: ${e}`
      );
    }

    // If the session expired, the title endpoint returns an HTML login page
    // (HTTP 200) instead of XML. Detect it at the boundary -- before parsing --
    // and abort rather than producing empty/garbage output.
    if (looksLikeLoginPage(titleReq.data)) {
      throw new SessionExpiredError();
    }

    foundAnyPart = true;
    const files = await parseTitle(titleReq.data);

    // create directory (only now that we know the part exists)
    try {
      await mkdir(partPath, { recursive: true });
    } catch (e: any) {
      if (e.code !== "EEXIST") {
        throw new Error(`Error creating directory ${partPath}: ${e}`);
      }
    }

    // write to disk
    await writeFile(join(partPath, "title.xml"), titleReq.data);
    await writeFile(
      join(partPath, "title.json"),
      JSON.stringify(files, null, 2)
    );

    for (const fileName in files) {
      const path = files[fileName];

      const fileExt = path.split(".")[1];
      const isPdf = fileExt === "pdf";

      const filePath = join(partPath, `${fileName}.${fileExt}`);

      // Resume support: skip files already downloaded in a previous run.
      if (isAlreadyDownloaded(filePath, MIN_VALID_EWD_FILE_BYTES)) {
        continue;
      }

      console.log(
        `Downloading ${manualData.id} ${part} ${fileName} as ${fileExt}...`
      );

      const fileReq = await client({
        method: "GET",
        url: `ewdappu/${manualData.id}/ewd/contents/${part}/${
          isPdf ? "pdf" : "fig"
        }/${path}`,
        responseType: isPdf ? "stream" : "text",
      });

      if (isPdf) {
        // response is stream, save as such
        await saveStream(fileReq.data, filePath);
      } else {
        // file isn't a stream, just write the text to disk
        if (looksLikeLoginPage(fileReq.data)) {
          throw new SessionExpiredError();
        }
        await writeFile(filePath, fileReq.data);
      }
    }
  }

  // No part responded -- the id is almost certainly wrong (a real EWD always
  // has at least "system").
  if (!foundAnyPart) {
    throw new Error(
      `EWD ${manualData.id} doesn't appear to exist-- are you sure the ID is right?`
    );
  }
}
