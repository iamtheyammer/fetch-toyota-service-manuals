import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { collectGenericTree, TreeNode } from "./tree";
import { collectEwdTree } from "./ewd";
import { renderManualPage, renderMasterPage } from "./render";
import { buildSearchIndex, renderSearchIndexJs } from "./searchIndex";

const EWD_PARTS = ["system", "routing", "overall"];

function isEwd(manualDir: string): boolean {
  return EWD_PARTS.some((p) => existsSync(join(manualDir, p, "title.json")));
}

/**
 * Write a self-contained offline browser (`index.html`) into one manual folder.
 * EWD when it has part `title.json`s, else generic when it has
 * `toc-downloaded.json`, else `null` (nothing to index — skipped).
 * Returns the folder name and the list of referenced files not found on disk.
 */
export async function buildManualIndex(
  manualDir: string
): Promise<{ label: string; missing: string[] } | null> {
  const label = basename(manualDir);
  let tree: TreeNode[];
  let missing: string[];

  if (isEwd(manualDir)) {
    ({ root: tree, missing } = collectEwdTree(manualDir));
  } else if (existsSync(join(manualDir, "toc-downloaded.json"))) {
    const toc = JSON.parse(readFileSync(join(manualDir, "toc-downloaded.json"), "utf8"));
    ({ root: tree, missing } = collectGenericTree(toc, manualDir));
  } else {
    return null;
  }

  writeFileSync(join(manualDir, "index.html"), renderManualPage(label, tree));

  // Full-text search index (extracts + caches PDF text) as a sibling script.
  const entries = await buildSearchIndex(manualDir, tree);
  writeFileSync(join(manualDir, "search-index.js"), renderSearchIndexJs(entries));

  return { label, missing };
}

/**
 * (Re)build the offline browser for every manual folder under `manualsDir`, plus
 * a master `index.html` listing them. Needs no network or cookie. Logs a summary.
 */
export async function buildAllIndexes(
  manualsDir: string
): Promise<{ total: number; missing: number }> {
  const dirs = readdirSync(manualsDir).filter((name) => {
    try {
      return statSync(join(manualsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });

  const built: { label: string; href: string }[] = [];
  let total = 0;
  let missing = 0;

  for (const name of dirs) {
    let res: { label: string; missing: string[] } | null;
    try {
      res = await buildManualIndex(join(manualsDir, name));
    } catch (e) {
      // One corrupt/partial source folder (bad JSON, truncated gzip) must not
      // sink the rest of the run or the master index.
      console.error(`${name}: skipped (couldn't read its data: ${e})`);
      continue;
    }
    if (!res) continue;
    total++;
    missing += res.missing.length;
    built.push({ label: res.label, href: encodeURIComponent(name) + "/index.html" });
    console.log(
      `${res.label}: index built${
        res.missing.length ? ` (⚠ ${res.missing.length} missing file(s))` : ""
      }`
    );
    for (const m of res.missing) console.log(`    missing: ${m}`);
  }

  writeFileSync(join(manualsDir, "index.html"), renderMasterPage(built));
  console.log(`\n${total} manual(s) indexed, ${missing} missing link(s) total.`);
  return { total, missing };
}
