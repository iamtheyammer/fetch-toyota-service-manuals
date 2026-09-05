import { test, describe } from "node:test";
import assert from "node:assert/strict";
import parseToC from "../src/genericManual/parseToC";

/**
 * Regression tests for the three ToC data-loss bugs fixed in PR #26, plus the
 * model-year filter. These are the parsing paths that decide which pages exist
 * at all -- a silent regression here loses manual pages without any error, and
 * is only visible after a (paid, time-boxed) live download.
 */

const toc = (items: string, bookTitle = "Test Manual") =>
  `<?xml version="1.0"?><xmltoc><name>${bookTitle}</name>${items}</xmltoc>`;

describe("parseToC", () => {
  test("nests leaves under their folder", () => {
    const parsed = parseToC(
      toc(`<item href="/a/"><name>Section A</name>
             <item href="/a/1.html"><name>Page One</name></item>
             <item href="/a/2.html"><name>Page Two</name></item>
           </item>`),
    );
    assert.deepEqual(parsed, {
      "Section A": { "Page One": "/a/1.html", "Page Two": "/a/2.html" },
    });
  });

  // Bug 1: a single top-level <item> parses as a bare object, not an array.
  // Legacy publications such as the wire-harness manual RM1022Ea hit this and
  // crashed the whole parse.
  test("handles a single top-level item (not an array)", () => {
    const parsed = parseToC(
      toc(`<item href="/w/"><name>Wire Harness</name>
             <item href="/w/1.html"><name>Connector List</name></item>
           </item>`),
    );
    assert.deepEqual(parsed, {
      "Wire Harness": { "Connector List": "/w/1.html" },
    });
  });

  // Bug 2: two sibling leaves sharing a display name silently overwrote each
  // other, dropping a page (real case: two distinct "EGR Flow Excessive
  // Monitor (P0402)" pages in one folder of the 2002 Highlander manual).
  test("keeps both sibling leaves that share a display name", () => {
    const parsed = parseToC(
      toc(`<item href="/f/"><name>Folder</name>
             <item href="/f/1.html"><name>EGR Flow (P0402)</name></item>
             <item href="/f/2.html"><name>EGR Flow (P0402)</name></item>
           </item>`),
    );
    assert.deepEqual(parsed, {
      Folder: {
        "EGR Flow (P0402)": "/f/1.html",
        "EGR Flow (P0402) (2)": "/f/2.html",
      },
    });
  });

  // Bug 3: a folder colliding with an earlier sibling leaf of the same name
  // threw and aborted the entire manual. The leaf must be relocated, not lost.
  test("keeps a leaf that collides with a later folder of the same name", () => {
    const parsed = parseToC(
      toc(`<item href="/r/"><name>Root</name>
             <item href="/r/x.html"><name>Brake</name></item>
             <item href="/r/brake/"><name>Brake</name>
               <item href="/r/brake/1.html"><name>Inner</name></item>
             </item>
           </item>`),
    );
    assert.deepEqual(parsed, {
      Root: {
        "Brake (page)": "/r/x.html",
        Brake: { Inner: "/r/brake/1.html" },
      },
    });
  });

  test("excludes pages outside the requested model year", () => {
    const xml = toc(`<item href="/y/"><name>Folder</name>
           <item href="/y/old.html"><name>Old Page</name>
             <tocdata fromyear="2010" toyear="2012"/>
           </item>
           <item href="/y/new.html"><name>New Page</name>
             <tocdata fromyear="2016" toyear="2020"/>
           </item>
         </item>`);
    assert.deepEqual(parseToC(xml, 2018), {
      Folder: { "New Page": "/y/new.html" },
    });
  });

  test("includes every page when no model year is given", () => {
    const xml = toc(`<item href="/y/"><name>Folder</name>
           <item href="/y/old.html"><name>Old Page</name>
             <tocdata fromyear="2010" toyear="2012"/>
           </item>
           <item href="/y/new.html"><name>New Page</name>
             <tocdata fromyear="2016" toyear="2020"/>
           </item>
         </item>`);
    assert.deepEqual(parseToC(xml), {
      Folder: { "Old Page": "/y/old.html", "New Page": "/y/new.html" },
    });
  });
});
