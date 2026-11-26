import processCLIArgs, {CLIArgs} from "./processCLIArgs";
import login from "./api/login";
import {join, resolve} from "path";
import {mkdir} from "fs/promises";
import downloadEWD from "./ewd";
import downloadGenericManual from "./genericManual";
import {buildAllIndexes} from "./buildIndex";
import {chromium, Cookie} from "playwright";
import {jar} from "./api/client";
import dayjs from "dayjs";

export interface Manual {
  type: "em" | "rm" | "bm" | "cr";
  id: string; // e.g. EM1234
  year?: number; // e.g. 2019
  raw: string; // e.g. EM1234@2019
}

async function run({manual, email, password, headed, cookieString}: CLIArgs) {
  // sort manuals and make sure that they're valid (ish)
  const ewds: Manual[] = [];
  const genericManuals: Manual[] = [];

  const rawManualIds = new Set(manual.map((m) => m.toUpperCase().trim()));

  console.log("Parsing manual IDs...");
  rawManualIds.forEach((m) => {
    // Optional explicit directory/type, mirroring the `dir=` segment in a TIS
    // viewer URL (e.g. `cr/BM3150U`). Toyota sometimes serves a publication under
    // a directory that doesn't match its ID's prefix -- for example BM3150U lives
    // under `cr`, not `bm` -- so this lets you override the path the tool fetches.
    const slashIdx = m.indexOf("/");
    const explicitType =
      slashIdx === -1 ? undefined : m.slice(0, slashIdx).toLowerCase();
    const spec = slashIdx === -1 ? m : m.slice(slashIdx + 1);

    const id = spec.includes("@") ? spec.split("@")[0] : spec;
    const year = spec.includes("@") ? parseInt(spec.split("@")[1]) : undefined;

    if (year && year !== -1) {
      if (isNaN(year)) {
        console.error(`Invalid manual ${m}: the model year must be a number.`);
        process.exit(1);
      } else {
        console.log(
          `Detected a manual with a year: ${m} (${year}). We'll try to download only manual pages that pertain to that year, but can't guarantee that it'll work.`
        );
      }
    }

    // An explicit type (e.g. `cr/BM3150U`) overrides prefix-based detection.
    if (explicitType) {
      if (explicitType === "em") {
        ewds.push({ type: "em", id, year, raw: spec });
      } else {
        genericManuals.push({
          type: explicitType as Manual["type"],
          id,
          year,
          raw: spec,
        });
      }
      return;
    }

    switch (id.slice(0, 2).toUpperCase()) {
      case "EM": {
        ewds.push({
          type: "em",
          id,
          year,
          raw: spec,
        });
        return;
      }
      case "RM": {
        genericManuals.push({
          type: "rm",
          id,
          year,
          raw: spec,
        });
        return;
      }
      case "BM": {
        genericManuals.push({
          type: "bm",
          id,
          year,
          raw: spec,
        });
        return;
      }
      case "CR": {
        genericManuals.push({
          type: "cr",
          id,
          year,
          raw: spec,
        });
        return;
      }
      default: {
        console.error(
          `Invalid manual ${m}: manual IDs must start with EM, RM, BM, or CR (or use type/id, e.g. cr/BM3150U).`
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
      Object.values(dirPaths).map((m) => mkdir(m, {recursive: true}))
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

  // Generate the offline two-pane browser (index.html) for every manual, plus a
  // master manuals/index.html. Runs over all downloads present, needs no network.
  console.log("Building offline browser index...");
  await buildAllIndexes(resolve(join(".", "manuals")));

  process.exit(0);
}

const args = processCLIArgs();
run(args);
