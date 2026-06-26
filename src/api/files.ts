import { existsSync, statSync } from "fs";

/**
 * Minimum byte sizes below which an already-present file is treated as
 * incomplete or garbage (a truncated download, or a saved error/login page)
 * and therefore re-downloaded rather than skipped on a resumed run.
 *
 * A genuine manual page PDF is always well over a couple of kilobytes; EWD
 * figures (svgz/pdf) are smaller but still comfortably above half a kilobyte.
 */
export const MIN_VALID_PDF_BYTES = 2048;
export const MIN_VALID_EWD_FILE_BYTES = 512;

/**
 * True if `filePath` already exists and is at least `minBytes` in size.
 *
 * Used to resume an interrupted download without re-fetching files that
 * completed on a previous run.
 */
export function isAlreadyDownloaded(
  filePath: string,
  minBytes: number
): boolean {
  return existsSync(filePath) && statSync(filePath).size > minBytes;
}
