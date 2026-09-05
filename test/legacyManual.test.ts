import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractPdfHref } from "../src/legacyManual/index";

/**
 * Legacy (pre-~2010) manuals serve each "page" as a thin xhtml wrapper that
 * points at the real PDF, in one of two shapes. Failing to extract the href
 * makes the tool silently classify a legacy manual as a modern one and
 * download nothing useful.
 */

describe("extractPdfHref", () => {
  const href = "/t3Portal/document/rm/RM1022Ea/pdf/RM000001.pdf";

  test("reads <link rel=pdf href=...>", () => {
    assert.equal(
      extractPdfHref(
        `<html><head><link rel="pdf" href="${href}"/></head></html>`,
      ),
      href,
    );
  });

  test("reads <link href=... rel=pdf> (attributes reversed)", () => {
    assert.equal(
      extractPdfHref(
        `<html><head><link href="${href}" rel="pdf"/></head></html>`,
      ),
      href,
    );
  });

  test("reads a location = '....pdf' script redirect", () => {
    assert.equal(
      extractPdfHref(`<html><script>location = "${href}";</script></html>`),
      href,
    );
  });

  test("is case-insensitive and accepts single quotes", () => {
    assert.equal(
      extractPdfHref(`<HTML><LINK REL='PDF' HREF='${href}'></HTML>`),
      href,
    );
  });

  test("returns undefined for a modern HTML page (no PDF link)", () => {
    assert.equal(
      extractPdfHref(
        "<html><body><h1>Some rendered manual page</h1></body></html>",
      ),
      undefined,
    );
  });

  test("ignores a non-pdf location redirect", () => {
    assert.equal(
      extractPdfHref(
        `<html><script>location = "/t3Portal/index.jsp";</script></html>`,
      ),
      undefined,
    );
  });
});
