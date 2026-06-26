import processCLIArgs, { CLIArgs } from "./processCLIArgs";
import login from "./api/login";
import { join, resolve } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import downloadEWD from "./ewd";
import downloadGenericManual from "./genericManual";
import downloadLegacyManual, { isLegacyPdfManual } from "./legacyManual";
import { fetchAndSaveToc } from "./manual/toc";
import { chromium, Cookie } from "playwright";
import { jar, TIS_HOST, TIS_ORIGIN } from "./api/client";
import { addCookiesToJar, parseCookieString } from "./api/cookies";
import { SessionExpiredError } from "./api/session";
import dayjs from "dayjs";

export interface Manual {
  // Path prefix / downloader selector. "em" -> modern EWD (ewdappu); all other
  // types share the generic "<type>/<id>/toc.xml" format and route through the
  // generic/legacy downloader: "rm" -> repair manual, "bm" -> body manual,
  // "ewd" -> older wiring diagram, "atm" -> automatic transmission manual,
  // "cr" -> collision/body repair manual, "ncf" -> new car features,
  // "whr" -> wire harness repair manual. The last four are common on older
  // vehicles, which split content across several standalone publications.
  type: "em" | "rm" | "bm" | "ewd" | "atm" | "cr" | "ncf" | "whr";
  id: string; // e.g. EM1234
  year?: number; // e.g. 2019
  raw: string; // e.g. EM1234@2019
}

/** All accepted explicit `-m <type>:<id>` type prefixes. */
const MANUAL_TYPES = [
  "rm",
  "bm",
  "em",
  "ewd",
  "atm",
  "cr",
  "ncf",
  "whr",
] as const;

/**
 * Infer a manual type from an ID's leading characters, for IDs given without an
 * explicit `type:` prefix. Returns undefined for unrecognized prefixes (older
 * IDs like OTH021U / EWD470U must be given an explicit type).
 *
 * Note: `BM####` body/collision manuals are now served under the `cr/` path
 * (TIS moved them from `bm/`), so a bare `BM` id autodetects to `cr`. The
 * explicit `bm:` prefix remains available as a fallback for any manual still on
 * the old path.
 */
function autodetectType(id: string): "em" | "rm" | "cr" | undefined {
  switch (id.slice(0, 2).toUpperCase()) {
    case "EM":
      return "em";
    case "RM":
      return "rm";
    case "BM":
      return "cr";
    default:
      return undefined;
  }
}

async function run({ manual, email, password, headed, cookieString }: CLIArgs) {
  // sort manuals and make sure that they're valid (ish)
  const ewds: Manual[] = [];
  const genericManuals: Manual[] = [];

  // Preserve the user-supplied case of each spec: most publication IDs are
  // all-uppercase, but some legacy ones carry a case-sensitive revision suffix
  // (e.g. the wire-harness manual "RM1022Ea"), and Toyota's endpoints are
  // case-sensitive. Type-prefix matching and prefix autodetection normalise
  // case themselves below, so no blanket upper-casing is needed here.
  const rawManualIds = new Set(manual.map((m) => m.trim()));

  console.log("Parsing manual IDs...");
  rawManualIds.forEach((m) => {
    // Optional explicit type prefix, e.g. "rm:OTH021U" or "ewd:EWD470U@2002".
    // Needed for older manuals whose IDs don't start with RM/EM/BM, and whose
    // wiring diagrams live under the generic "ewd/" path (not modern ewdappu).
    let explicitType: string | undefined;
    let spec = m;
    const colonIdx = m.indexOf(":");
    if (colonIdx > 0) {
      const prefix = m.slice(0, colonIdx).toLowerCase();
      if ((MANUAL_TYPES as readonly string[]).includes(prefix)) {
        explicitType = prefix;
        spec = m.slice(colonIdx + 1);
      }
    }

    const id = spec.includes("@") ? spec.split("@")[0] : spec;
    const year = spec.includes("@") ? parseInt(spec.split("@")[1]) : undefined;
    const raw = spec; // directory name (id + optional @year), without type prefix

    if (year !== undefined && year !== -1) {
      if (isNaN(year)) {
        console.error(`Invalid manual ${m}: the model year must be a number.`);
        process.exit(1);
      } else {
        console.log(
          `Detected a manual with a year: ${raw} (${year}). We'll try to download only manual pages that pertain to that year, but can't guarantee that it'll work.`
        );
      }
    }

    const type = explicitType || autodetectType(id);
    switch (type) {
      case "em": {
        ewds.push({ type: "em", id, year, raw });
        return;
      }
      case "rm": {
        genericManuals.push({ type: "rm", id, year, raw });
        return;
      }
      case "bm": {
        genericManuals.push({ type: "bm", id, year, raw });
        return;
      }
      case "ewd": {
        genericManuals.push({ type: "ewd", id, year, raw });
        return;
      }
      case "atm":
      case "cr":
      case "ncf":
      case "whr": {
        genericManuals.push({ type, id, year, raw });
        return;
      }
      default: {
        console.error(
          `Invalid manual ${m}: prefix the ID with a type ` +
            `(rm:/bm:/em:/ewd:/atm:/cr:/ncf:/whr:) ` +
            `or use an ID starting with EM, RM, or BM.`
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

  // copy accessor into manuals
  console.log("Copying accessor into manuals...");
  try {
    const accessorHTML = await readFile(
      join(__dirname, "..", "accessor/index.html"),
      "utf-8"
    );
    await Promise.all(
      Object.values(dirPaths).map((m) =>
        writeFile(join(m, "index.html"), accessorHTML)
      )
    );
  } catch (e) {
    console.error("Unable to copy accessor file into manuals.", e);
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
      domain: TIS_HOST,
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

    // Parse the cookie header into Playwright cookies (for the browser context)
    // and load the same set into the axios jar (for the HTTP downloaders).
    transformedCookies = parseCookieString(cookieString);
    addCookiesToJar(transformedCookies);
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
  const resp = await page.goto(`${TIS_ORIGIN}/t3Portal/`, {
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

  // download other manuals - generic format. The ToC is fetched and saved once
  // here, then passed to the appropriate downloader. Older manuals serve each
  // page as a direct PDF (downloaded via axios); modern ones are HTML rendered
  // to PDF via Playwright. Detect which per manual and dispatch accordingly.
  for (const manualIdx in genericManuals) {
    const manual = genericManuals[manualIdx];
    const path = dirPaths[manual.id];

    console.log(`Downloading ${manual.raw}...`);
    const toc = await fetchAndSaveToc(manual, path);

    if (await isLegacyPdfManual(toc)) {
      console.log(`${manual.raw} is a legacy PDF manual.`);
      await downloadLegacyManual(toc, path);
    } else {
      await downloadGenericManual(page, toc, path);
    }
  }

  console.log("All manuals downloaded!");
  process.exit(0);
}

const args = processCLIArgs();
run(args).catch((e) => {
  if (e instanceof SessionExpiredError) {
    console.error(`\n${e.message}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
