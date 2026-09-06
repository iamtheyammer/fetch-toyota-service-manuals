import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyManualDir, verifyEwdDir } from "../src/manual/verify.ts";

/**
 * Completeness checking used to be a copy-paste Node snippet in the docs, which
 * is both easy to get wrong and easy to skip. It is the only thing that proves
 * a download actually finished, so it belongs in the tool.
 */

function fixture(toc: unknown, files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "tis-verify-"));
  writeFileSync(join(dir, "toc-downloaded.json"), JSON.stringify(toc));
  for (const f of files) {
    const full = join(dir, f);
    mkdirSync(join(full, ".."), { recursive: true });
    // Comfortably above the login-stub threshold.
    writeFileSync(full, Buffer.alloc(4096, 0x41));
  }
  return dir;
}

describe("verifyManualDir", () => {
  test("reports a complete manual", () => {
    const dir = fixture(
      { Section: { "Page One": "/a/1", "Page Two": "/a/2" } },
      ["Section/Page One.pdf", "Section/Page Two.pdf"],
    );
    const r = verifyManualDir(dir);
    assert.equal(r.leaves, 2);
    assert.equal(r.present, 2);
    assert.deepEqual(r.missing, []);
    assert.equal(r.complete, true);
  });

  test("lists the pages that are missing", () => {
    const dir = fixture(
      { Section: { "Page One": "/a/1", "Page Two": "/a/2" } },
      ["Section/Page One.pdf"],
    );
    const r = verifyManualDir(dir);
    assert.equal(r.present, 1);
    assert.equal(r.missing.length, 1);
    assert.match(r.missing[0], /Page Two\.pdf$/);
    assert.equal(r.complete, false);
  });

  test("treats a login-page stub as missing, not present", () => {
    const dir = mkdtempSync(join(tmpdir(), "tis-verify-"));
    writeFileSync(
      join(dir, "toc-downloaded.json"),
      JSON.stringify({ "A Page": "/a/1" }),
    );
    writeFileSync(join(dir, "A Page.pdf"), "tiny login page");
    const r = verifyManualDir(dir);
    assert.equal(r.present, 0);
    assert.equal(r.stubs.length, 1);
    assert.equal(r.complete, false);
  });

  test("applies the same slash sanitisation the downloader uses", () => {
    // "ABS / VSC" becomes "ABS - VSC" on disk, one path segment.
    const dir = fixture({ "ABS / VSC": "/a/1" }, ["ABS - VSC.pdf"]);
    assert.equal(verifyManualDir(dir).complete, true);
  });

  test("walks nested folders", () => {
    const dir = fixture({ A: { B: { C: { Deep: "/x" } } } }, [
      "A/B/C/Deep.pdf",
    ]);
    assert.equal(verifyManualDir(dir).complete, true);
  });

  test("throws a clear error when there is no ToC to check against", () => {
    const dir = mkdtempSync(join(tmpdir(), "tis-verify-"));
    assert.throws(() => verifyManualDir(dir), /toc-downloaded\.json/);
  });
});

describe("verifyEwdDir", () => {
  function ewdFixture(
    parts: Record<string, Record<string, string>>,
    files: string[],
  ): string {
    const dir = mkdtempSync(join(tmpdir(), "tis-ewd-"));
    for (const [part, title] of Object.entries(parts)) {
      mkdirSync(join(dir, part), { recursive: true });
      writeFileSync(join(dir, part, "title.json"), JSON.stringify(title));
    }
    for (const f of files) {
      writeFileSync(join(dir, f), Buffer.alloc(2048, 0x41));
    }
    return dir;
  }

  test("reports a complete EWD", () => {
    // Files are named by the ToC key plus the extension from its value.
    const dir = ewdFixture(
      {
        system: { "Audio System (AS)": "AS.svgz", "Charging (CS)": "CS.svgz" },
      },
      ["system/Audio System (AS).svgz", "system/Charging (CS).svgz"],
    );
    const r = verifyEwdDir(dir);
    assert.equal(r.leaves, 2);
    assert.equal(r.present, 2);
    assert.equal(r.complete, true);
  });

  test("detects a missing figure", () => {
    const dir = ewdFixture(
      {
        system: { "Audio System (AS)": "AS.svgz", "Charging (CS)": "CS.svgz" },
      },
      ["system/Audio System (AS).svgz"],
    );
    const r = verifyEwdDir(dir);
    assert.equal(r.present, 1);
    assert.equal(r.missing.length, 1);
    assert.match(r.missing[0], /Charging \(CS\)\.svgz$/);
  });

  test("handles pdf and svgz figures in one part", () => {
    const dir = ewdFixture(
      { overall: { "Overall A": "A.pdf", "Fig B": "B.svgz" } },
      ["overall/Overall A.pdf", "overall/Fig B.svgz"],
    );
    assert.equal(verifyEwdDir(dir).complete, true);
  });

  test("walks every part directory", () => {
    const dir = ewdFixture(
      { system: { A: "a.svgz" }, routing: { B: "b.svgz" } },
      ["system/A.svgz", "routing/B.svgz"],
    );
    assert.equal(verifyEwdDir(dir).leaves, 2);
  });

  test("uses the smaller EWD size threshold", () => {
    // 600 bytes is a valid EWD figure but would fail the 2048-byte PDF rule.
    const dir = ewdFixture({ system: { A: "a.svgz" } }, []);
    writeFileSync(join(dir, "system", "A.svgz"), Buffer.alloc(600, 0x41));
    assert.equal(verifyEwdDir(dir).complete, true);
  });
});
