import processCLIArgs, { CLIArgs } from "./processCLIArgs";
import login from "./api/login";
import { join, resolve } from "path";
import { mkdir } from "fs/promises";
import downloadEWD from "./ewd";

async function run({ manual, email, password }: CLIArgs) {
  // sort manuals and make sure that they're valid (ish)
  const ewds: string[] = [];
  const collisionManuals: string[] = [];
  const repairManuals: string[] = [];

  const manualIds = manual.map((m) => m.toUpperCase().trim());

  console.log("Parsing manual IDs...");
  manualIds.forEach((m) => {
    switch (m.slice(0, 2).toUpperCase()) {
      case "EM": {
        ewds.push(m);
        return;
      }
      case "RM": {
        repairManuals.push(m);
        return;
      }
      case "BM": {
        collisionManuals.push(m);
        return;
      }
      default: {
        console.error(
          `Invalid manual ${m}: manual IDs must start with EM, RM, or BM.`
        );
        process.exit(1);
      }
    }
  });

  console.log("Creating directories for manuals...");
  // create directories
  const dirPaths: { [manualId: string]: string } = Object.fromEntries(
    manualIds.map((m) => [m, resolve(join(".", "manuals", m))])
  );

  try {
    await Promise.all(
      Object.values(dirPaths).map((m) => mkdir(m, { recursive: true }))
    );
  } catch (e: any) {
    if (e.code !== "EEXIST") {
      console.error(`Error creating directory: ${e}`);
      process.exit(1);
    }
  }

  console.log("Logging into TIS...");
  // login and get cookies
  try {
    await login(email, password);
  } catch (e: any) {
    console.log("Error logging in. Please check your username and password.");
    console.log(e.toString());
    return;
  }

  console.log("Beginning manual downloads...");
  // begin downloads
  for (const ewdIdx in ewds) {
    const ewdId = ewds[ewdIdx];
    await downloadEWD(ewdId, dirPaths[ewdId]);
  }
}

const args = processCLIArgs();
run(args);
