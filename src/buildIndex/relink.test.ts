import assert from "assert";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PDFDocument, PDFName, PDFString, PDFDict, PDFArray } from "pdf-lib";
import {
  docIdFromUri,
  buildDocIdMap,
  processManualPdf,
  renderRefsIndexJs,
} from "./relink";

// Build a 1-page PDF with the given URI link annotations, return its path.
async function makePdfWithLinks(
  dir: string,
  name: string,
  uris: string[]
): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const refs = uris.map((uri, i) => {
    const d = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10 + i * 20, 290, 25 + i * 20],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(uri) },
    });
    return doc.context.register(d);
  });
  page.node.set(PDFName.of("Annots"), doc.context.obj(refs));
  const p = join(dir, name);
  writeFileSync(p, await doc.save());
  return p;
}

// Read back the S and URI (if any) of each Link annotation on page 1.
async function readLinkActions(
  path: string
): Promise<{ s: string; uri?: string }[]> {
  const doc = await PDFDocument.load(readFileSync(path));
  const page = doc.getPages()[0];
  const annots = page.node.Annots() as PDFArray | undefined;
  const out: { s: string; uri?: string }[] = [];
  if (!annots) return out;
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookup(i, PDFDict);
    if (!annot) continue;
    const A = annot.lookup(PDFName.of("A"), PDFDict);
    if (!A) continue;
    const s = A.get(PDFName.of("S"))!.toString();
    const uriObj = A.has(PDFName.of("URI"))
      ? A.lookup(PDFName.of("URI"), PDFString)
      : undefined;
    out.push({ s, uri: uriObj ? uriObj.asString() : undefined });
  }
  return out;
}

(async () => {
  // --- docIdFromUri ---
  assert.equal(
    docIdFromUri(
      "https://techinfo.toyota.com/t3Portal/document/rm/RM3150U/xhtml/RM100000000B8NI.html?linkId=x#y",
      "RM3150U"
    ),
    "RM100000000B8NI"
  );
  // directory segment may differ from the id prefix (cr-served BM manual)
  assert.equal(
    docIdFromUri(
      "https://techinfo.toyota.com/t3Portal/document/cr/BM3150U/xhtml/RM100000000TB8M.html",
      "BM3150U"
    ),
    "RM100000000TB8M"
  );
  assert.equal(docIdFromUri("https://example.com/foo", "RM3150U"), null);
  // a link into a DIFFERENT manual must not match
  assert.equal(
    docIdFromUri(
      "https://techinfo.toyota.com/t3Portal/document/rm/RM9999U/xhtml/RM1.html",
      "RM3150U"
    ),
    null
  );

  // --- buildDocIdMap ---
  const toc = {
    General: {
      "SECTION A": {
        "PAGE ONE": "/t3Portal/document/rm/RM3150U/xhtml/RM_AAA.html",
      },
    },
    "SECTION B": {
      "PAGE TWO": "/t3Portal/document/rm/RM3150U/xhtml/RM_BBB.html?foo=bar",
    },
  };
  const map = buildDocIdMap(toc);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get("RM_AAA"), {
    href: "General/SECTION%20A/PAGE%20ONE.pdf",
    title: "General › SECTION A › PAGE ONE",
  });
  assert.ok(map.get("RM_BBB"), "query string on the path still maps");

  // --- processManualPdf: rewrite matched links to GoToR, leave others ---
  const dir = mkdtempSync(join(tmpdir(), "relink-"));
  // source lives two folders deep so the relative path must climb two levels
  const { mkdirSync } = require("fs");
  mkdirSync(join(dir, "General", "SECTION A"), { recursive: true });
  const srcHref = "General/SECTION%20A/PAGE%20ONE.pdf";
  const srcDisk = await makePdfWithLinks(
    join(dir, "General", "SECTION A"),
    "PAGE ONE.pdf",
    [
      "https://techinfo.toyota.com/t3Portal/document/rm/RM3150U/xhtml/RM_BBB.html#z", // -> local
      "https://techinfo.toyota.com/t3Portal/document/rm/RM3150U/xhtml/RM_GONE.html", // not downloaded
    ]
  );

  const res = await processManualPdf(srcDisk, "RM3150U", map, srcHref, {
    relink: true,
  });
  assert.equal(res.changed, 1, "exactly one link points at a downloaded page");
  assert.deepEqual(res.refs, [
    { href: "SECTION%20B/PAGE%20TWO.pdf", title: "SECTION B › PAGE TWO" },
  ]);

  const actions = await readLinkActions(srcDisk);
  const goto = actions.find((a) => a.s === "/GoToR");
  const keptUri = actions.find((a) => a.s === "/URI");
  assert.ok(goto, "matched link became a GoToR action");
  assert.ok(
    keptUri && keptUri.uri!.includes("RM_GONE"),
    "unmatched link keeps its techinfo URI"
  );

  // Re-running is idempotent: the GoToR link is no longer a URI to rewrite.
  const res2 = await processManualPdf(srcDisk, "RM3150U", map, srcHref, {
    relink: true,
  });
  assert.equal(res2.changed, 0, "second pass rewrites nothing");
  assert.equal(res2.refs.length, 0, "no URI links left to collect refs from");

  // --- renderRefsIndexJs ---
  const js = renderRefsIndexJs({ "a/b.pdf": [{ href: "c.pdf", title: "C" }] });
  assert.ok(js.startsWith("window.__REFS__ = "));
  assert.ok(!js.includes("</script"), "angle brackets are escaped");

  console.log("OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
