import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { manualDirPath, DEFAULT_OUT_DIR } from "../src/manual/paths.ts";

/**
 * Downloads used to land directly in ./manuals, so a second vehicle's
 * publications interleaved with the first (an FJ Cruiser's RM sitting beside
 * an LX600's). outDir gives each vehicle its own folder while leaving the
 * original layout as the default.
 */

describe("manualDirPath", () => {
  test("defaults to ./manuals/<raw>", () => {
    assert.equal(
      manualDirPath(DEFAULT_OUT_DIR, "RM3900U@2024"),
      resolve("manuals/RM3900U@2024"),
    );
  });

  test("places a manual under a per-vehicle directory", () => {
    assert.equal(
      manualDirPath("manuals/toyota_fj_cruiser", "RM12345"),
      resolve("manuals/toyota_fj_cruiser/RM12345"),
    );
  });

  test("keeps the @year suffix in the directory name", () => {
    assert.equal(
      manualDirPath("manuals/lexus_lx600_2024", "RM3900U@2024"),
      resolve("manuals/lexus_lx600_2024/RM3900U@2024"),
    );
  });

  test("returns an absolute path", () => {
    assert.ok(manualDirPath("manuals", "RM1").startsWith("/"));
  });

  test("falls back to the default when outDir is empty", () => {
    assert.equal(manualDirPath("", "RM1"), resolve("manuals/RM1"));
  });

  test("accepts an absolute outDir unchanged", () => {
    assert.equal(
      manualDirPath("/tmp/tis-out", "RM1"),
      resolve("/tmp/tis-out/RM1"),
    );
  });
});
