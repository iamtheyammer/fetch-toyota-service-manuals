import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isAlreadyDownloaded,
  MIN_VALID_PDF_BYTES,
  MIN_VALID_EWD_FILE_BYTES,
} from "../src/api/files";

/**
 * Resume support: a re-run must skip completed files but re-fetch truncated
 * ones and saved login-page stubs. Getting the size guard wrong either wastes
 * a whole (paid, time-boxed) subscription window re-downloading everything, or
 * silently leaves login pages in the archive posing as manual pages.
 */

const dir = mkdtempSync(join(tmpdir(), "tis-files-"));

function file(name: string, bytes: number): string {
  const p = join(dir, name);
  writeFileSync(p, Buffer.alloc(bytes, 0x41));
  return p;
}

describe("isAlreadyDownloaded", () => {
  test("false for a file that does not exist", () => {
    assert.equal(
      isAlreadyDownloaded(join(dir, "missing.pdf"), MIN_VALID_PDF_BYTES),
      false
    );
  });

  test("true for a complete PDF", () => {
    assert.equal(
      isAlreadyDownloaded(file("full.pdf", MIN_VALID_PDF_BYTES + 1), MIN_VALID_PDF_BYTES),
      true
    );
  });

  test("false for a login-page stub masquerading as a PDF", () => {
    // Saved TIS login pages are a few hundred bytes -- these must be re-fetched.
    assert.equal(isAlreadyDownloaded(file("stub.pdf", 400), MIN_VALID_PDF_BYTES), false);
  });

  test("false for an empty file from an interrupted write", () => {
    assert.equal(isAlreadyDownloaded(file("empty.pdf", 0), MIN_VALID_PDF_BYTES), false);
  });

  test("false at exactly the threshold (strictly greater is required)", () => {
    assert.equal(
      isAlreadyDownloaded(file("exact.pdf", MIN_VALID_PDF_BYTES), MIN_VALID_PDF_BYTES),
      false
    );
  });

  test("applies the smaller EWD threshold to figures", () => {
    const svgz = file("fig.svgz", MIN_VALID_EWD_FILE_BYTES + 1);
    assert.equal(isAlreadyDownloaded(svgz, MIN_VALID_EWD_FILE_BYTES), true);
    // The same file would be rejected under the stricter PDF threshold.
    assert.equal(isAlreadyDownloaded(svgz, MIN_VALID_PDF_BYTES), false);
  });
});
