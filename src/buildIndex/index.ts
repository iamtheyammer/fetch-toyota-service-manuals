import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { collectGenericTree, TreeNode } from "./tree";
import { collectEwdTree } from "./ewd";
import { renderManualPage, renderMasterPage } from "./render";
import { buildSearchIndex, renderSearchIndexJs } from "./searchIndex";
import { buildRefsAndRelink, renderRefsIndexJs } from "./relink";

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
  manualDir: string,
  opts: { relinkPdfs?: boolean } = {}
): Promise<{ label: string; missing: string[]; relinked: number } | null> {
  const label = basename(manualDir);
  let tree: TreeNode[];
  let missing: string[];
  let toc: unknown = null;

  if (isEwd(manualDir)) {
    ({ root: tree, missing } = collectEwdTree(manualDir));
  } else if (existsSync(join(manualDir, "toc-downloaded.json"))) {
    toc = JSON.parse(readFileSync(join(manualDir, "toc-downloaded.json"), "utf8"));
    ({ root: tree, missing } = collectGenericTree(toc, manualDir));
  } else {
    return null;
  }

  writeFileSync(join(manualDir, "index.html"), renderManualPage(label, tree));

  // Full-text search index (extracts + caches PDF text) as a sibling script.
  const entries = await buildSearchIndex(manualDir, tree);
  writeFileSync(join(manualDir, "search-index.js"), renderSearchIndexJs(entries));

  // Cross-reference index: maps each generic page's in-document "INFO" links to
  // the local pages they point at (and, with relinkPdfs, rewrites them in-PDF).
  // EWD manuals have no such links, so they just get an empty sibling script.
  let relinked = 0;
  if (toc) {
    ({ relinked } = await buildRefsAndRelink(manualDir, toc, tree, {
      relinkPdfs: !!opts.relinkPdfs,
    }));
  } else {
    writeFileSync(join(manualDir, "refs-index.js"), renderRefsIndexJs({}));
  }

  return { label, missing, relinked };
}

/**
 * (Re)build the offline browser for every manual folder under `manualsDir`, plus
 * a master `index.html` listing them. Needs no network or cookie. Logs a summary.
 */
export async function buildAllIndexes(
  manualsDir: string,
  opts: { relinkPdfs?: boolean } = {}
): Promise<{ total: number; missing: number; relinked: number }> {
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
  let relinked = 0;

  for (const name of dirs) {
    let res: { label: string; missing: string[]; relinked: number } | null;
    try {
      res = await buildManualIndex(join(manualsDir, name), opts);
    } catch (e) {
      // One corrupt/partial source folder (bad JSON, truncated gzip) must not
      // sink the rest of the run or the master index.
      console.error(`${name}: skipped (couldn't read its data: ${e})`);
      continue;
    }
    if (!res) continue;
    total++;
    missing += res.missing.length;
    relinked += res.relinked;
    built.push({ label: res.label, href: encodeURIComponent(name) + "/index.html" });
    console.log(
      `${res.label}: index built${
        res.missing.length ? ` (⚠ ${res.missing.length} missing file(s))` : ""
      }${res.relinked ? ` (${res.relinked} in-PDF link(s) re-linked)` : ""}`
    );
    for (const m of res.missing) console.log(`    missing: ${m}`);
  }

  writeFileSync(join(manualsDir, "index.html"), renderMasterPage(built));
  console.log(
    `\n${total} manual(s) indexed, ${missing} missing link(s) total${
      opts.relinkPdfs ? `, ${relinked} in-PDF link(s) re-linked` : ""
    }.`
  );
  return { total, missing, relinked };
}
