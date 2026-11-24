import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { TreeNode } from "./tree";
import { extractPdfText } from "./extractText";

export type SearchEntry = { href: string; title: string; text: string };

/** Flatten a tree into leaf descriptors, titling each by its full section path. */
export function flattenLeaves(tree: TreeNode[]): { href: string; title: string }[] {
  const out: { href: string; title: string }[] = [];
  function walk(nodes: TreeNode[], path: string[]): void {
    for (const n of nodes) {
      if (n.children) {
        walk(n.children, [...path, n.label]);
      } else if (n.href) {
        out.push({ href: n.href, title: [...path, n.label].join(" › ") });
      }
    }
  }
  walk(tree, []);
  return out;
}

/** On-disk path of a leaf, reconstructed from its (encoded) href. */
function leafDiskPath(manualDir: string, href: string): string {
  return join(manualDir, ...href.split("/").map(decodeURIComponent));
}

type Cache = { [href: string]: { mtimeMs: number; text: string } };

/**
 * Build the per-manual search index: one entry per leaf page, carrying the PDF's
 * extracted text (non-PDF leaves, e.g. SVG diagrams, get empty text so they stay
 * title-searchable). Extracted text is cached in `.search-cache.json` keyed by
 * href + file mtime, so re-runs only re-extract new or changed PDFs.
 */
export async function buildSearchIndex(
  manualDir: string,
  tree: TreeNode[]
): Promise<SearchEntry[]> {
  const cachePath = join(manualDir, ".search-cache.json");
  let cache: Cache = {};
  try {
    if (existsSync(cachePath)) cache = JSON.parse(readFileSync(cachePath, "utf8")) as Cache;
  } catch {
    cache = {};
  }

  const nextCache: Cache = {};
  const entries: SearchEntry[] = [];

  for (const leaf of flattenLeaves(tree)) {
    let text = "";
    if (leaf.href.toLowerCase().endsWith(".pdf")) {
      const disk = leafDiskPath(manualDir, leaf.href);
      if (existsSync(disk)) {
        const mtimeMs = statSync(disk).mtimeMs;
        const cached = cache[leaf.href];
        if (cached && cached.mtimeMs === mtimeMs) {
          text = cached.text;
        } else {
          try {
            text = await extractPdfText(disk);
          } catch {
            text = ""; // one unreadable PDF stays title-searchable, doesn't fail the build
          }
        }
        nextCache[leaf.href] = { mtimeMs, text };
      }
    }
    entries.push({ href: leaf.href, title: leaf.title, text });
  }

  try {
    writeFileSync(cachePath, JSON.stringify(nextCache));
  } catch {
    /* cache is best-effort */
  }

  return entries;
}

/** Render the index as a sibling script that sets `window.__SEARCH__`. */
export function renderSearchIndexJs(entries: SearchEntry[]): string {
  return `window.__SEARCH__ = ${JSON.stringify(entries).replace(/</g, "\\u003c")};`;
}
