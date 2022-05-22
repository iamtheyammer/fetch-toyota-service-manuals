import processCLIArgs, { CLIArgs } from "./processCLIArgs";
import login from "./api/login";
import { join, resolve } from "path";
import { mkdir } from "fs/promises";
import downloadEWD from "./ewd";
import downloadGenericManual from "./genericManual";
import {chromium, Cookie} from "playwright";
import {jar} from "./api/client";
import dayjs from "dayjs";

async function run({ manual, email, password }: CLIArgs) {
  // sort manuals and make sure that they're valid (ish)
  const ewds: string[] = [];
  const genericManuals: string[] = [];

  const manualIds = new Set(manual.map((m) => m.toUpperCase().trim()));

  console.log("Parsing manual IDs...");
  manualIds.forEach((m) => {
    switch (m.slice(0, 2).toUpperCase()) {
      case "EM": {
        ewds.push(m);
        return;
      }
      case "RM": {
        genericManuals.push(m);
        return;
      }
      case "BM": {
        genericManuals.push(m);
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

  // create directories
  const dirPaths: { [manualId: string]: string } = Object.fromEntries(
    Array.from(manualIds).map((m) => [m, resolve(join(".", "manuals", m))])
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

  console.log("Setting up Playwright...");
  const browser = await chromium.launch({
    headless: true
  });

  const transformedCookies: Cookie[] = jar.toJSON().cookies.map(c => ({
    name: c.key,
    value: c.value,
    domain: "techinfo.toyota.com",
    // for some reason, we have to do this-- otherwise, the iPlanetDirectoryPro
    // cookie isn't sent, which means that the session isn't working
    secure: true,
    sameSite: "None",
    path: c.path,
    httpOnly: false,
    // expires: c.expires ? dayjs(c.expires).unix() : dayjs().add(1, "day").unix()
    expires: dayjs().add(1, "day").unix()
  }));

  const page = await browser.newPage({
    acceptDownloads: false,
    storageState: {
      cookies: transformedCookies,
      origins: []
    }
  });

  console.log("Checking that Playwright is logged in...");
  const resp = await page.goto("https://techinfo.toyota.com/t3Portal/", {
    waitUntil: "commit"
  });
  if(!resp || !resp.url().endsWith("t3Portal/")) {
    throw new Error(`Doesn't appear we're logged into TIS, we're at ${resp ? resp.url() : "unknown URL"}`)
  }

  console.log("Beginning manual downloads...");
  // begin downloads
  for (const ewdIdx in ewds) {
    const ewdId = ewds[ewdIdx];
    console.log(`Downloading ${ewdId}... (type = ewd)`)
    await downloadEWD(ewdId, dirPaths[ewdId]);
  }

  // download other manuals - requires playwright
  for (const manualIdx in genericManuals) {
    const manualId = genericManuals[manualIdx];
    console.log(`Downloading ${manualId}... (type = generic)`)
    await downloadGenericManual(page, manualId, dirPaths[manualId])
  }

  console.log("All manuals downloaded!");
  process.exit(0);
}

const args = processCLIArgs();
run(args);
