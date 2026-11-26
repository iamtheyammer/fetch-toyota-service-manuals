import assert from "assert";
import { fileHref, relPath, collectGenericTree } from "./tree";

// fileHref encodes AND sanitizes each segment
assert.equal(
  fileHref(["General", 'Camshaft "A"'], "pdf"),
  "General/Camshaft%20-A-.pdf" // " -> - (sanitize), space -> %20 (encode)
);

// relPath sanitizes but does not URL-encode (human-readable relative path)
assert.equal(relPath(["General", 'Camshaft "A"'], "pdf"), "General/Camshaft -A-.pdf");

// collectGenericTree builds nodes and flags missing files, without throwing on an absent dir
const toc = { Sec: { "Page X": "/t3Portal/a.html" } };
const { root, missing } = collectGenericTree(toc, "/no/such/dir");
assert.equal(root[0].label, "Sec");
assert.equal(root[0].children?.[0]?.href, "Sec/Page%20X.pdf");
assert.deepEqual(missing, ["Sec/Page X.pdf"]);

console.log("OK");
