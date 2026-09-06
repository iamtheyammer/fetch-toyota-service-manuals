import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import type { ParsedToC } from "../genericManual/parseToC.ts";
import { sanitizeName } from "./paths.ts";
import { looksLikeConcurrentLoginPage } from "../api/session.ts";
import { MIN_VALID_PDF_BYTES, MIN_VALID_EWD_FILE_BYTES } from "../api/files.ts";

/**
 * Check a downloaded manual against its own table of contents.
 *
 * This is the only thing that proves a run actually finished. TIS answers an
 * expired session with HTTP 200 and a login page rather than an error, so a
 * partial download looks exactly like a complete one unless the pages are
 * counted -- and a saved login page looks like a real file unless its size is
 * checked. Both are covered here so the check cannot be forgotten or mistyped.
 */
export interface VerifyResult {
  /** Total leaf pages the (year-filtered) ToC expects. */
  leaves: number;
  /** Pages present on disk at a plausible size. */
  present: number;
  /** Expected page files that are absent entirely. */
  missing: string[];
  /** Files that exist but are too small to be a real page (saved login pages). */
  stubs: string[];
  complete: boolean;
}

/**
 * @param manualDir a single manual's directory (the one holding toc-downloaded.json)
 * @throws if the directory has no ToC, i.e. the download never got far enough
 *         to be worth verifying.
 */
export function verifyManualDir(manualDir: string): VerifyResult {
  const tocPath = join(manualDir, "toc-downloaded.json");
  if (!existsSync(tocPath)) {
    throw new Error(
      `No toc-downloaded.json in ${manualDir} -- either it is not a manual ` +
        `directory, or the download never fetched a table of contents.`,
    );
  }

  const toc: ParsedToC = JSON.parse(readFileSync(tocPath, "utf8"));
  const missing: string[] = [];
  const stubs: string[] = [];
  let leaves = 0;
  let present = 0;

  const walk = (node: ParsedToC, dir: string): void => {
    for (const [name, value] of Object.entries(node)) {
      const safe = sanitizeName(name);
      if (typeof value === "string") {
        leaves++;
        const filePath = join(dir, `${safe}.pdf`);
        if (!existsSync(filePath)) {
          missing.push(filePath);
        } else if (statSync(filePath).size <= MIN_VALID_PDF_BYTES) {
          // Present but implausibly small: a saved login page or a truncated
          // write. Re-running the download replaces these.
          stubs.push(filePath);
        } else {
          present++;
        }
      } else {
        walk(value, join(dir, safe));
      }
    }
  };
  walk(toc, manualDir);

  return {
    leaves,
    present,
    missing,
    stubs,
    complete: missing.length === 0 && stubs.length === 0,
  };
}

/**
 * Check a downloaded EWD (electrical wiring diagram) against its title lists.
 *
 * EWDs have no toc-downloaded.json: each part directory (system, routing,
 * overall, ...) carries a title.json mapping a figure's display name to its
 * remote filename, and the downloader saves it as `<display name>.<ext>`,
 * taking the extension from the remote name. Without this, `verify` would skip
 * EWDs silently and report a vehicle as fully downloaded while its wiring
 * diagrams were incomplete.
 */
export function verifyEwdDir(ewdDir: string): VerifyResult {
  const missing: string[] = [];
  const stubs: string[] = [];
  let leaves = 0;
  let present = 0;

  for (const entry of readdirSync(ewdDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const partDir = join(ewdDir, entry.name);
    const titlePath = join(partDir, "title.json");
    if (!existsSync(titlePath)) continue;

    const title: Record<string, string> = JSON.parse(
      readFileSync(titlePath, "utf8"),
    );
    for (const [displayName, remoteName] of Object.entries(title)) {
      leaves++;
      const ext = remoteName.split(".")[1];
      const filePath = join(partDir, `${displayName}.${ext}`);
      if (!existsSync(filePath)) {
        missing.push(filePath);
      } else if (statSync(filePath).size <= MIN_VALID_EWD_FILE_BYTES) {
        // EWD figures are legitimately small, so they get the smaller floor.
        stubs.push(filePath);
      } else {
        present++;
      }
    }
  }

  return {
    leaves,
    present,
    missing,
    stubs,
    complete: missing.length === 0 && stubs.length === 0,
  };
}

/** A group of files that are all exactly the same number of bytes. */
export interface SizeCluster {
  size: number;
  files: string[];
}

/**
 * Default threshold for treating an identical-size group as suspicious.
 *
 * Calibrated against real archives: a verified-good 5,189-page manual set's
 * largest identical-size group was 14 files, while two corrupted sets had
 * 1,914 and 973 files at exactly 27,043 bytes.
 */
export const SUSPICIOUS_CLUSTER_SIZE = 20;

/**
 * Groups of identically sized files, largest first.
 *
 * This is how a saved interstitial is caught. TIS serves its "Concurrent Login
 * Alert" with HTTP 200 at the requested page's own URL, so it renders to a
 * valid multi-kilobyte PDF that satisfies every existence and size check --
 * a run can report 1915/1915 complete while nearly all of it is one warning
 * page repeated. Genuine manual pages differ in length; hundreds of pages
 * agreeing to the byte do not happen by chance.
 *
 * Deliberately content-agnostic: Playwright embeds subsetted fonts, so the
 * words are not recoverable from the PDF without an external tool, and this
 * has to work without one.
 */
export function findIdenticalSizeClusters(
  files: { path: string; size: number }[],
  minCluster: number = SUSPICIOUS_CLUSTER_SIZE,
): SizeCluster[] {
  const bySize = new Map<number, string[]>();
  for (const f of files) {
    const list = bySize.get(f.size);
    if (list) list.push(f.path);
    else bySize.set(f.size, [f.path]);
  }

  return [...bySize.entries()]
    .filter(([, paths]) => paths.length >= minCluster)
    .map(([size, paths]) => ({ size, files: paths }))
    .sort((a, b) => b.files.length - a.files.length);
}

/**
 * Extract a PDF's first-page text, or undefined if it cannot be read.
 *
 * Shells out to poppler's pdftotext. Doing this in-process is not practical:
 * Playwright embeds subsetted fonts, so a PDF's content streams hold glyph ids
 * rather than words, and recovering text means interpreting each font's
 * ToUnicode CMap. pdftotext already does that correctly.
 */
export function pdfFirstPageText(path: string): string | undefined {
  try {
    return execFileSync("pdftotext", ["-l", "1", path, "-"], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

/** True if poppler's pdftotext is available to confirm suspected pages. */
export function canReadPdfText(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export type ClusterVerdict = "confirmed" | "clean" | "unknown";

/**
 * Decide whether a suspected cluster really is TIS's interstitial by reading
 * the pages, rather than trusting the size coincidence alone.
 *
 * Identical byte sizes are only a signal: a manual can legitimately contain
 * many short pages that happen to render to the same length, and deleting real
 * content on that basis would be worse than the bug. Sampling the actual text
 * turns the heuristic into a decision, and "unknown" is returned rather than
 * guessed when pdftotext is unavailable.
 */
export function classifyCluster(
  files: string[],
  sample = 5,
): { verdict: ClusterVerdict; checked: number; matched: number } {
  if (!canReadPdfText()) return { verdict: "unknown", checked: 0, matched: 0 };

  let checked = 0;
  let matched = 0;
  for (const f of files.slice(0, sample)) {
    const text = pdfFirstPageText(f);
    if (text === undefined) continue;
    checked++;
    if (looksLikeConcurrentLoginPage(text)) matched++;
  }
  if (!checked) return { verdict: "unknown", checked, matched };
  return {
    verdict:
      matched === checked ? "confirmed" : matched > 0 ? "confirmed" : "clean",
    checked,
    matched,
  };
}
