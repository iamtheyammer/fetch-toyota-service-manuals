import assert from "assert";
import { renderManualPage, renderMasterPage } from "./render";

const html = renderManualPage("BM3150U", [
  { label: "Sec", children: [{ label: "P", href: "Sec/P.pdf" }] },
]);
assert.match(html, /<!doctype html>/i);
assert.match(html, /window\.__TREE__\s*=/);
assert.ok(html.includes("Sec/P.pdf"));
assert.ok(!/src\s*=\s*["']https?:/i.test(html)); // self-contained: no REMOTE scripts/styles
assert.ok(html.includes("search-index.js")); // loads the sibling search index (offline-local)

// an empty group renders without throwing
const empty = renderManualPage("X", [{ label: "Empty", children: [] }]);
assert.match(empty, /Empty/);

// master page lists links to each manual's index.html
const master = renderMasterPage([{ label: "BM3150U", href: "BM3150U/index.html" }]);
assert.ok(master.includes("BM3150U/index.html"));

console.log("OK");
