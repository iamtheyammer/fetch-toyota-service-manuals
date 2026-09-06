import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { vehicleSlug } from "../tools/fetchVehicle.ts";
import { chooseXzSettings } from "../tools/archive.ts";

describe("vehicleSlug", () => {
  test("builds a filesystem-safe folder name", () => {
    assert.equal(vehicleSlug("LEXUS", "LX600", "2024"), "lexus_lx600_2024");
  });

  test("collapses spaces in multi-word models", () => {
    assert.equal(
      vehicleSlug("TOYOTA", "FJ Cruiser", "2008"),
      "toyota_fj_cruiser_2008",
    );
  });

  test("strips characters that are awkward in paths", () => {
    // Real TIS model names include these, e.g. "RAV4 HV" and "NX450H+".
    assert.equal(vehicleSlug("LEXUS", "NX450H+", "2023"), "lexus_nx450h_2023");
    assert.equal(
      vehicleSlug("TOYOTA", "RAV4 HV", "2020"),
      "toyota_rav4_hv_2020",
    );
  });

  test("never leaves leading or trailing separators", () => {
    const slug = vehicleSlug("TOYOTA", "  Prius  ", "2015");
    assert.equal(slug, "toyota_prius_2015");
    assert.ok(!slug.startsWith("_") && !slug.endsWith("_"));
  });
});

describe("chooseXzSettings", () => {
  const GB = 1024 ** 3;

  test("uses many threads when memory is plentiful", () => {
    const s = chooseXzSettings(32 * GB, 12);
    assert.equal(s.threads, 12);
  });

  // The case that actually bit us: 12 cores but ~1GB free. xz -9e -T0 would
  // have reached for ~8GB and thrashed or been OOM-killed.
  test("throttles threads when memory is scarce", () => {
    const s = chooseXzSettings(1 * GB, 12);
    assert.ok(
      s.threads < 12,
      `expected fewer than 12 threads, got ${s.threads}`,
    );
    assert.ok(s.threads >= 1);
  });

  test("always returns at least one thread", () => {
    assert.equal(chooseXzSettings(1024, 12).threads, 1);
  });

  test("is conservative when memory cannot be determined", () => {
    const s = chooseXzSettings(undefined, 12);
    assert.ok(s.threads >= 1 && s.threads <= 12);
  });
});
