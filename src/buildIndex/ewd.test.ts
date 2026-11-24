import assert from "assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gzipSync } from "zlib";
import { ensureSvg, collectEwdTree } from "./ewd";

// ensureSvg gunzips a .svgz to a sibling .svg and is idempotent
const dir = mkdtempSync(join(tmpdir(), "ewdsvg-"));
writeFileSync(join(dir, "d.svgz"), gzipSync(Buffer.from("<svg/>")));
ensureSvg(join(dir, "d.svgz"));
assert.equal(readFileSync(join(dir, "d.svg"), "utf8"), "<svg/>");
ensureSvg(join(dir, "d.svgz")); // second call: no throw, still correct
assert.equal(readFileSync(join(dir, "d.svg"), "utf8"), "<svg/>");

// collectEwdTree: overall .pdf stays .pdf; system .svgz becomes .svg (and is decompressed)
const m = mkdtempSync(join(tmpdir(), "ewdman-"));
mkdirSync(join(m, "overall"), { recursive: true });
writeFileSync(join(m, "overall", "title.json"), JSON.stringify({ "ABS (16)": "16.pdf" }));
writeFileSync(join(m, "overall", "ABS (16).pdf"), "x");
mkdirSync(join(m, "system"), { recursive: true });
writeFileSync(join(m, "system", "title.json"), JSON.stringify({ "4WD (4WD)": "4WD.svgz" }));
writeFileSync(join(m, "system", "4WD (4WD).svgz"), gzipSync(Buffer.from("<svg/>")));

// A ".svgz" that is actually plain SVG (this tool's axios already decoded the
// transport-layer gzip) must be copied as-is, not gunzipped (which would throw).
const plainDir = mkdtempSync(join(tmpdir(), "ewdplain-"));
writeFileSync(join(plainDir, "p.svgz"), "<svg>hi</svg>");
ensureSvg(join(plainDir, "p.svgz"));
assert.equal(readFileSync(join(plainDir, "p.svg"), "utf8"), "<svg>hi</svg>");

const { root, missing } = collectEwdTree(m);
assert.deepEqual(missing, []);
const overall = root.find((n) => n.label === "overall");
assert.equal(overall?.children?.[0]?.href, "overall/ABS%20(16).pdf");
const system = root.find((n) => n.label === "system");
assert.equal(system?.children?.[0]?.href, "system/4WD%20(4WD).svg");
assert.ok(existsSync(join(m, "system", "4WD (4WD).svg"))); // decompressed sibling exists

console.log("OK");
