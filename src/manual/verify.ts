import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { ParsedToC } from "../genericManual/parseToC.ts";
import { sanitizeName } from "./paths.ts";
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
