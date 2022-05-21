import { createWriteStream } from "fs";

export default function saveStream(stream: any, path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const writer = createWriteStream(path);
    stream.pipe(writer);

    writer.on("error", (err) => {
      writer.close();
      reject(err);
    });

    writer.on("close", () => {
      resolve();
    });
  });
}
