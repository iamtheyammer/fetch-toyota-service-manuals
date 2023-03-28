import processCLIArgs, { CLIArgs } from "./processCLIArgs";
import login from "./api/login";
import { join, resolve } from "path";
import { mkdir } from "fs/promises";
import downloadEWD from "./ewd";
import downloadGenericManual from "./genericManual";
import { chromium, Cookie } from "playwright";
import { jar } from "./api/client";
import dayjs from "dayjs";

export interface Manual {
  type: "em" | "rm" | "bm";
  id: string; // e.g. EM1234
  year?: number; // e.g. 2019
  raw: string; // e.g. EM1234@2019
}

async function run({ manual, email, password, headed, cookieString }: CLIArgs) {
  // sort manuals and make sure that they're valid (ish)
  const ewds: Manual[] = [];
  const genericManuals: Manual[] = [];

  const rawManualIds = new Set(manual.map((m) => m.toUpperCase().trim()));

  console.log("Parsing manual IDs...");
  rawManualIds.forEach((m) => {
    const id = m.includes("@") ? m.split("@")[0] : m;
    const year = m.includes("@") ? parseInt(m.split("@")[1]) : -1;

    if (year !== -1) {
      if (isNaN(year)) {
        console.error(`Invalid manual ${m}: the model year must be a number.`);
        process.exit(1);
      } else {
        console.log(
          `Detected a manual with a year: ${m} (${year}). We'll try to download only manual pages that pertain to that year, but can't guarantee that it'll work.`
        );
      }
    }

    switch (m.slice(0, 2).toUpperCase()) {
      case "EM": {
        ewds.push({
          type: "em",
          id,
          year,
          raw: m,
        });
        return;
      }
      case "RM": {
        genericManuals.push({
          type: "rm",
          id,
          year,
          raw: m,
        });
        return;
      }
      case "BM": {
        genericManuals.push({
          type: "bm",
          id,
          year,
          raw: m,
        });
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
    [...ewds, ...genericManuals].map((m) => [
      m.id,
      resolve(join(".", "manuals", m.raw)),
    ])
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

  console.log("Setting up Playwright...");
  const browser = await chromium.launch({
    headless: !headed,
  });

  let transformedCookies: Cookie[] = [];

  if (email && password) {
    console.log("Logging into TIS using email and password...");
    // login and get cookies
    try {
      await login(email, password);
    } catch (e: any) {
      console.log("Error logging in. Please check your username and password.");
      console.log(e.toString());
      return;
    }

    transformedCookies = jar.toJSON().cookies.map((c) => ({
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
      expires: dayjs().add(1, "day").unix(),
    }));
  } else if (cookieString) {
    console.log("Using cookies from command line...");

    // parse cookie string
    const cookieStrings = cookieString.split("; ");
    // transform cookie strings into cookie objects
    transformedCookies = cookieStrings.map((c) => {
      const [name, value] = c.split("=");
      return {
        name,
        value,
        domain: "techinfo.toyota.com",
        // for some reason, we have to do this-- otherwise, the iPlanetDirectoryPro
        // cookie isn't sent, which means that the session isn't working
        secure: true,
        sameSite: "None",
        path: "/",
        httpOnly: false,
        expires: dayjs().add(1, "day").unix(),
      };
    });

    // add cookies to axios jar
    transformedCookies.forEach((c) => {
      jar.setCookieSync(
        `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}; Expires=${c.expires}; Secure; SameSite=None`,
        "https://techinfo.toyota.com/t3Portal/"
      );
    });
  } else {
    console.log(
      "No credentials provided. Please provide either a cookie string or email/password."
    );
    process.exit(1);
  }

  const page = await browser.newPage({
    acceptDownloads: false,
    storageState: {
      // add cookies to browser
      cookies: transformedCookies,
      origins: [],
    },
  });

  console.log("Checking that Playwright is logged in...");
  const resp = await page.goto("https://techinfo.toyota.com/t3Portal/", {
    waitUntil: "commit",
  });
  if (!resp || !resp.url().endsWith("t3Portal/")) {
    throw new Error(
      `Doesn't appear we're logged into TIS, we're at ${
        resp ? resp.url() : "unknown URL"
      }`
    );
  }

  console.log("Beginning manual downloads...");
  // begin downloads
  for (const ewdIdx in ewds) {
    const ewd = ewds[ewdIdx];
    console.log(`Downloading ${ewd.raw}... (type = ewd)`);
    await downloadEWD(ewd, dirPaths[ewd.id]);
  }

  // download other manuals - requires playwright
  for (const manualIdx in genericManuals) {
    const manual = genericManuals[manualIdx];

    console.log(`Downloading ${manual.raw}... (type = generic)`);
    await downloadGenericManual(page, manual, dirPaths[manual.id]);
  }

  console.log("All manuals downloaded!");
  process.exit(0);
}

const args = processCLIArgs();
run(args);
