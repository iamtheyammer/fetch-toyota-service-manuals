import { test, describe } from "node:test";
import assert from "node:assert/strict";
import parseTitle from "../src/ewd/parseTitle";

/**
 * The EWD title list maps figure names to the PDF/SVGZ files to download.
 * Current TIS XML adds an <?controldate?> processing instruction, which broke
 * the original positional lookup -- pinned here along with the single-entry
 * and non-downloadable-type paths.
 */

describe("parseTitle", () => {
  test("maps figure names to their downloadable file names", async () => {
    const xml = `<?xml version="1.0"?><TitleList>
      <System>
        <name code="A">Power Source</name>
        <fig type="pdf">PS001</fig>
      </System>
      <System>
        <name code="B">Ground Point</name>
        <fig type="svgz">GP002</fig>
      </System>
    </TitleList>`;
    assert.deepEqual(await parseTitle(xml), {
      "Power Source (PS001)": "PS001.pdf",
      "Ground Point (GP002)": "GP002.svgz",
    });
  });

  // The regression: xml-js emits _instruction for <?controldate?>, so the old
  // Object.values(TitleList)[1] positional lookup grabbed the wrong child.
  test("tolerates a leading <?controldate?> instruction", async () => {
    const xml = `<?xml version="1.0"?><TitleList>
      <?controldate 20240101?>
      <System>
        <name code="A">Power Source</name>
        <fig type="pdf">PS001</fig>
      </System>
    </TitleList>`;
    assert.deepEqual(await parseTitle(xml), { "Power Source (PS001)": "PS001.pdf" });
  });

  test("handles a single entry (object, not array)", async () => {
    const xml = `<?xml version="1.0"?><TitleList>
      <Routing>
        <name code="R">Routing Diagram</name>
        <fig type="pdf">RD001</fig>
      </Routing>
    </TitleList>`;
    assert.deepEqual(await parseTitle(xml), {
      "Routing Diagram (RD001)": "RD001.pdf",
    });
  });

  test("skips entries that are not pdf or svgz", async () => {
    const xml = `<?xml version="1.0"?><TitleList>
      <System>
        <name code="A">Real Page</name>
        <fig type="pdf">PS001</fig>
      </System>
      <System>
        <name code="B">Not Downloadable</name>
        <fig type="html">NX001</fig>
      </System>
    </TitleList>`;
    assert.deepEqual(await parseTitle(xml), { "Real Page (PS001)": "PS001.pdf" });
  });

  test("replaces slashes in names so they stay one path segment", async () => {
    const xml = `<?xml version="1.0"?><TitleList>
      <System>
        <name code="A">ABS / VSC / TRAC</name>
        <fig type="pdf">AV001</fig>
      </System>
    </TitleList>`;
    assert.deepEqual(await parseTitle(xml), {
      "ABS - VSC - TRAC (AV001)": "AV001.pdf",
    });
  });

  test("returns an empty map for an empty title list", async () => {
    assert.deepEqual(await parseTitle(`<?xml version="1.0"?><TitleList/>`), {});
  });
});
