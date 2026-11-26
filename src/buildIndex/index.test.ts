import assert from "assert";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildManualIndex, buildAllIndexes } from "./index";

(async () => {
  // buildManualIndex writes index.html (+ search-index.js) for a generic manual
  // fixture and reports missing files.
  const dir = mkdtempSync(join(tmpdir(), "idxtest-"));
  writeFileSync(
    join(dir, "toc-downloaded.json"),
    JSON.stringify({ Sec: { P: "/t3Portal/x.html" } })
  );

  const res = await buildManualIndex(dir);
  assert.ok(res, "expected a result (not null)");
  assert.ok(existsSync(join(dir, "index.html")), "index.html should be written");
  assert.ok(existsSync(join(dir, "search-index.js")), "search-index.js should be written");
  assert.deepEqual(res.missing, ["Sec/P.pdf"]); // no PDF on disk -> reported

  // buildAllIndexes must contain a corrupt source folder: skip it, still index the
  // good manuals, and still write the master index.
  const root = mkdtempSync(join(tmpdir(), "idxall-"));
  mkdirSync(join(root, "bad"));
  writeFileSync(join(root, "bad", "toc-downloaded.json"), "{ not valid json");
  mkdirSync(join(root, "good"));
  writeFileSync(join(root, "good", "toc-downloaded.json"), JSON.stringify({ Sec: { P: "/x" } }));

  const all = await buildAllIndexes(root);
  assert.ok(existsSync(join(root, "index.html")), "master index written despite bad folder");
  assert.ok(existsSync(join(root, "good", "index.html")), "good manual still indexed");
  assert.equal(all.total, 1); // only the good manual counted

  console.log("OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
