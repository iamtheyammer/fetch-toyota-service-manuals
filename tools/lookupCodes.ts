import commandLineArgs from "command-line-args";
import { chromium, Page } from "playwright";
import { resolveCookieString } from "./lib/harCookie";
import { parseCookieString } from "../src/api/cookies";
import { TIS_ORIGIN } from "../src/api/client";

/**
 * Look up the publication codes (Repair Manual, EWD, Body Manual, …) for a
 * given vehicle by driving the TIS catalog: it selects the division/model/year
 * on the repair-search form, then visits each document-type tab and scrapes the
 * `publicationNumber`/`objType` off the result links.
 *
 * Usage:
 *   TIS_COOKIE='...' ts-node tools/lookupCodes.ts --model RAV4 --year 2020
 *   ts-node tools/lookupCodes.ts --model "RAV4 HV" --year 2020 --har ~/Downloads/techinfo.har
 *
 * Output lists each code with the exact `-m` flag to pass to the downloader.
 */

const TIS_CATALOG_URL = `${TIS_ORIGIN}/t3Portal/appmanager/t3/ti?_nfpb=true&_pageLabel=t3_tis`;

// WebLogic portlet-mangled field names on the repair-search form.
const FIELD = {
  division: "repairformwlw-select_key:{actionForm.division}",
  model: "repairformwlw-select_key:{actionForm.model}",
  year: "repairformwlw-select_key:{actionForm.year}",
};

// How long to let the cascading dropdowns / search settle after an interaction.
const SETTLE_MS = 2500;
const SEARCH_SETTLE_MS = 4000;

export interface FoundDoc {
  type: string; // objType, e.g. "rm", "ewdappu", "bm"
  publicationNumber: string;
}

/** A division/model/year selection on the TIS repair-search form. */
export interface VehicleSelector {
  division: string;
  model: string;
  year: string;
}

/**
 * objTypes that are multi-page manuals (each backed by a `toc.xml`) and so are
 * downloaded by the main `yarn start` flow. Every other objType is a standalone
 * single-PDF document (TSB, recall, bulletin, …) handled by
 * `tools/downloadDocuments.ts`. Single source of truth for that split.
 */
export const MANUAL_OBJ_TYPES = new Set([
  "rm",
  "bm",
  "em",
  "ewd",
  "ewdappu",
  "atm",
  "cr",
  "ncf",
  "whr",
]);

/** Extract the `_pageLabel` value from a TIS portal URL, or "" if absent. */
function pageLabelOf(url: string): string {
  return (url.match(/_pageLabel=([^&]+)/) || [])[1] || "";
}

/** Pull distinct {objType, publicationNumber} pairs out of result-link hrefs. */
function parseDocsFromHrefs(hrefs: (string | null)[]): FoundDoc[] {
  const seen = new Map<string, FoundDoc>();
  for (const href of hrefs) {
    if (!href) continue;
    const pub = (href.match(/publicationNumber=([^&]+)/) || [])[1];
    if (!pub) continue;
    const type =
      (href.match(/objType=([^&]+)/) || [])[1] ||
      (href.match(/[?&]dir=([a-z]+)/) || [])[1] ||
      "?";
    const publicationNumber = decodeURIComponent(pub);
    seen.set(`${type}:${publicationNumber}`, { type, publicationNumber });
  }
  return [...seen.values()];
}

/** Collect document links across every frame of the current page. */
async function docsOnPage(page: Page): Promise<FoundDoc[]> {
  let hrefs: (string | null)[] = [];
  for (const frame of page.frames()) {
    const frameHrefs = await frame
      .$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))
      .catch(() => [] as (string | null)[]);
    hrefs = hrefs.concat(frameHrefs);
  }
  return parseDocsFromHrefs(hrefs);
}

/** Select a cascading dropdown value and wait for any dependent reload. */
async function selectAndSettle(page: Page, name: string, value: string) {
  const selector = `select[name="${name}"]`;
  await page.waitForSelector(selector, { timeout: 30000 });
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.selectOption(selector, value).catch((e) => {
      throw new Error(`Could not select ${name}="${value}": ${e.message}`);
    }),
  ]);
  await page.waitForTimeout(SETTLE_MS);
}

/** Human label for an objType. */
function typeLabel(type: string): string {
  switch (type) {
    case "rm":
      return "Repair Manual";
    case "ewdappu":
      return "Wiring Diagram (modern EWD)";
    case "ewd":
      return "Wiring Diagram (legacy)";
    case "bm":
      return "Body/Collision Manual";
    case "cr":
      return "Collision/Body Repair Manual";
    case "atm":
      return "Automatic Transmission Manual";
    case "whr":
      return "Wire Harness Repair Manual";
    case "ncf":
      return "New Car Features";
    default:
      return type;
  }
}

/** The exact downloader `-m` flag for a given objType + publication number. */
function downloaderFlag(type: string, pub: string, year: string): string {
  const upper2 = pub.slice(0, 2).toUpperCase();
  switch (type) {
    case "rm":
      // Repair manuals support year filtering; legacy ids need an explicit type.
      return upper2 === "RM" ? `-m ${pub}@${year}` : `-m rm:${pub}@${year}`;
    case "ewdappu":
      return upper2 === "EM" ? `-m ${pub}` : `-m em:${pub}`;
    case "ewd":
      return `-m ewd:${pub}`;
    case "bm":
      return upper2 === "BM" ? `-m ${pub}@${year}` : `-m bm:${pub}@${year}`;
    case "atm":
    case "cr":
    case "ncf":
    case "whr":
      // Older standalone manual publications: explicit type prefix, no year
      // filter (they're single-purpose and downloaded in full).
      return `-m ${type}:${pub}`;
    default:
      return `-m ${pub}`;
  }
}

/**
 * Drive the TIS catalog for one vehicle and return every document it lists:
 * select the division/model/year, run the repair search, then visit each
 * document-type library tab and scrape the `publicationNumber`/`objType` off the
 * result links. The returned list is de-duped by `objType:publicationNumber`.
 *
 * @throws if the session is invalid (expired or bumped by a concurrent login).
 */
export async function collectDocuments(
  selector: VehicleSelector,
  cookieString: string
): Promise<FoundDoc[]> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    storageState: {
      cookies: parseCookieString(cookieString),
      origins: [],
    },
  });
  page.setDefaultTimeout(30000);

  try {
    await page.goto(TIS_CATALOG_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Fail fast with a clear message if the session is dead (expired, or bumped
    // by a concurrent login) -- otherwise the form selects never appear and we
    // would time out cryptically.
    if (/concurrentLoginFailure|custom-login|\/login/i.test(page.url())) {
      throw new Error(
        "TIS session is not valid (expired, or bumped by a concurrent login). " +
          "Capture a fresh HAR while logged in, with no other TIS sessions open."
      );
    }

    await selectAndSettle(page, FIELD.division, selector.division);
    await selectAndSettle(page, FIELD.model, selector.model);
    await selectAndSettle(page, FIELD.year, selector.year);

    // Run the repair search (lands on the Repair Manual results tab).
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      page
        .click('input[value="Search"], #searchButton')
        .catch((e) => console.error("Search click warning:", e.message)),
    ]);
    await page.waitForTimeout(SEARCH_SETTLE_MS);

    const byKey = new Map<string, FoundDoc>();
    const collect = (docs: FoundDoc[]) =>
      docs.forEach((d) => byKey.set(`${d.type}:${d.publicationNumber}`, d));

    collect(await docsOnPage(page));

    // Visit every other document-type library tab (lib_<type>_page) and scrape
    // it too. A heavily-bulletined vehicle (e.g. an older Prius) can expose
    // hundreds of result links that all share the same handful of tab
    // pageLabels -- they differ only by pagination / per-document query params.
    // De-dupe by the `_pageLabel` value, not the full href, keeping one
    // representative per real tab; visiting every href would open hundreds of
    // pages and eventually crash the browser.
    const currentLabel = pageLabelOf(page.url());
    const tabHrefs: string[] = await page
      .$$eval("a[href]", (as) =>
        (as as HTMLAnchorElement[])
          .map((a) => a.href)
          .filter((h) => /_pageLabel=lib_[a-z]+_page/.test(h))
      )
      .catch(() => []);
    const tabByLabel = new Map<string, string>();
    for (const href of tabHrefs) {
      const label = pageLabelOf(href);
      if (label && label !== currentLabel && !tabByLabel.has(label)) {
        tabByLabel.set(label, href);
      }
    }
    for (const href of tabByLabel.values()) {
      await page.goto(href, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(SETTLE_MS);
      collect(await docsOnPage(page));
    }

    return [...byKey.values()];
  } finally {
    await browser.close();
  }
}

async function main() {
  const opts = commandLineArgs([
    { name: "model", type: String },
    { name: "year", type: String },
    { name: "division", type: String, defaultValue: "TOYOTA" },
    { name: "har", type: String },
  ]);

  if (!opts.model || !opts.year) {
    console.error(
      "Usage: ts-node tools/lookupCodes.ts --model <Model> --year <Year> [--division TOYOTA] [--har <har-path>]"
    );
    process.exit(2);
  }

  const cookieString = resolveCookieString(opts.har);
  const docs = await collectDocuments(
    { division: opts.division, model: opts.model, year: opts.year },
    cookieString
  );

  // Group by objType for a readable, stable listing.
  const byType = new Map<string, Set<string>>();
  for (const d of docs) {
    if (!byType.has(d.type)) byType.set(d.type, new Set());
    byType.get(d.type)!.add(d.publicationNumber);
  }

  console.log(`\nCodes for ${opts.division} ${opts.model} ${opts.year}:`);
  if (!byType.size) {
    console.log("  (no documents found -- check the model/year spelling)");
    return;
  }

  // Manuals (multi-page, fetched by `yarn start`) and standalone documents
  // (single PDFs, fetched by `yarn download-documents`) need different tools, so
  // list and summarise them separately.
  const manualFlags: string[] = [];
  let bulletinCount = 0;
  for (const [type, set] of [...byType.entries()].sort()) {
    const isManual = MANUAL_OBJ_TYPES.has(type);
    for (const pub of [...set].sort()) {
      if (isManual) {
        const flag = downloaderFlag(type, pub, opts.year);
        manualFlags.push(flag.replace(/^-m /, ""));
        console.log(
          `  ${typeLabel(type).padEnd(28)} ${pub.padEnd(14)} ${flag}`
        );
      } else {
        bulletinCount++;
        console.log(
          `  ${typeLabel(type).padEnd(28)} ${pub.padEnd(14)} (bulletin)`
        );
      }
    }
  }

  if (manualFlags.length) {
    console.log(
      `\nDownload the manuals:\n  yarn start ${manualFlags
        .map((f) => `-m ${f}`)
        .join(" ")}`
    );
  }
  if (bulletinCount) {
    console.log(
      `\nDownload the ${bulletinCount} standalone document(s) (TSBs, recalls, ` +
        `bulletins):\n  yarn download-documents --model "${opts.model}" ` +
        `--year ${opts.year}` +
        (opts.division !== "TOYOTA" ? ` --division "${opts.division}"` : "")
    );
  }
}

// Only run the CLI when invoked directly (e.g. `ts-node tools/lookupCodes.ts`),
// not when imported for `collectDocuments` (e.g. by tools/downloadDocuments.ts).
if (require.main === module) {
  main().catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
}
