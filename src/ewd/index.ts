import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { client } from "../api/client";
import { AxiosResponse } from "axios";
import parseTitle from "./parseTitle";
import saveStream from "../api/saveStream";
import { Manual } from "..";

export default async function downloadEWD(manualData: Manual, path: string) {
  const parts = ["system", "routing", "overall"];

  // download
  for (const partIdx in parts) {
    const part = parts[partIdx];
    const partPath = join(path, part);

    // create directory
    try {
      await mkdir(partPath, { recursive: true });
    } catch (e: any) {
      if (e.code !== "EEXIST") {
        throw new Error(`Error creating directory ${path}: ${e}`);
      }
    }

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
        throw new Error(
          `EWD ${manualData.id} doesn't appear to exist-- are you sure the ID is right?`
        );
      }

      throw new Error(
        `Unknown error getting title XML for EWD ${manualData.id}: ${e}`
      );
    }

    const files = await parseTitle(titleReq.data);

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

      const filePath = join(partPath, `${fileName}.${fileExt}`);
      if (isPdf) {
        // response is stream, save as such
        await saveStream(fileReq.data, filePath);
      } else {
        // file isn't a stream, just write the text to disk
        await writeFile(filePath, fileReq.data);
      }
    }
  }
}
