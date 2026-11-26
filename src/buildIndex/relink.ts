import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFHexString,
  PDFDict,
  PDFArray,
} from "pdf-lib";
import { fileHref, TreeNode } from "./tree";
import { flattenLeaves } from "./searchIndex";

/** A cross-reference target: the local page a link points at. */
export type Ref = { href: string; title: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The doc id (xhtml filename) of a TIS link into manual `id`, or null. */
export function docIdFromUri(uri: string, id: string): string | null {
  // e.g. .../document/<dir>/<id>/xhtml/RM100000000B8NI.html?linkId=..#..
  // The directory segment can differ from the id prefix (BM manuals live under
  // cr/), so match any directory but require the id to be this manual's.
  const re = new RegExp(
    "/document/[^/]+/" + escapeRegExp(id) + "/xhtml/([^/?#]+?)\\.html",
    "i"
  );
  const m = uri.match(re);
  return m ? m[1].toUpperCase() : null;
}

/** The doc id at the end of a ToC path value (`.../xhtml/RM_AAA.html`), or null. */
function docIdFromTocPath(path: string): string | null {
  const m = path.match(/\/([^/]+)\.html?(?:[?#].*)?$/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Map every downloaded page's doc id to its local file (same href + title the
 * browse tree uses), by walking the generic manual's `toc-downloaded.json`.
 */
export function buildDocIdMap(toc: unknown): Map<string, Ref> {
  const map = new Map<string, Ref>();
  (function walk(obj: Record<string, unknown>, segs: string[]): void {
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      const s = [...segs, key];
      if (typeof v === "string") {
        const docid = docIdFromTocPath(v);
        if (docid) map.set(docid, { href: fileHref(s, "pdf"), title: s.join(" › ") });
      } else if (v && typeof v === "object") {
        walk(v as Record<string, unknown>, s);
      }
    }
  })((toc ?? {}) as Record<string, unknown>, []);
  return map;
}

/** Derive the manual id (e.g. RM3150U) from the ToC, falling back to the folder. */
function deriveId(toc: unknown, manualDir: string): string {
  let found: string | null = null;
  (function walk(o: unknown): void {
    if (found || !o || typeof o !== "object") return;
    for (const v of Object.values(o as Record<string, unknown>)) {
      if (found) return;
      if (typeof v === "string") {
        const m = v.match(/\/document\/[^/]+\/([^/]+)\/xhtml\//i);
        if (m) {
          found = m[1];
          return;
        }
      } else {
        walk(v);
      }
    }
  })(toc);
  return found ?? basename(manualDir).split("@")[0];
}

/**
 * Read one page PDF's cross-reference links. For each link into another
 * downloaded page, record the local target; when `relink` is set, also rewrite
 * the link's action to a relative GoToR so it opens the local file in viewers
 * that allow it (Adobe Reader — Chrome/Edge block PDF links to file:// targets).
 * Links to pages that weren't downloaded are left pointing at TIS.
 */
export async function processManualPdf(
  diskPath: string,
  id: string,
  docMap: Map<string, Ref>,
  sourceHref: string,
  opts: { relink: boolean }
): Promise<{ refs: Ref[]; changed: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(readFileSync(diskPath), { updateMetadata: false });
  } catch {
    return { refs: [], changed: 0 }; // unreadable PDF: skip, don't fail the build
  }

  const refs: Ref[] = [];
  const seen = new Set<string>();
  let changed = 0;

  // How many folders up from this page to the manual root, for relative links.
  const upDepth = sourceHref.split("/").length - 1;

  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i, PDFDict);
      if (!annot) continue;
      if (annot.get(PDFName.of("Subtype"))?.toString() !== "/Link") continue;
      const A = annot.lookup(PDFName.of("A"), PDFDict);
      if (!A || A.get(PDFName.of("S"))?.toString() !== "/URI") continue;
      const uriObj = A.lookup(PDFName.of("URI"), PDFString);
      if (!uriObj) continue;

      const docid = docIdFromUri(uriObj.asString(), id);
      if (!docid) continue;
      const target = docMap.get(docid);
      if (!target) continue; // links to a page we didn't download: leave as TIS

      if (!seen.has(target.href)) {
        seen.add(target.href);
        refs.push(target);
      }

      if (opts.relink) {
        const rel =
          "../".repeat(upDepth) +
          target.href.split("/").map(decodeURIComponent).join("/");
        const fileSpec = doc.context.obj({
          Type: "Filespec",
          F: PDFString.of(rel),
          UF: PDFHexString.fromText(rel),
        });
        annot.set(
          PDFName.of("A"),
          doc.context.obj({
            S: "GoToR",
            F: fileSpec,
            D: doc.context.obj([0, "Fit"]),
            NewWindow: false,
          })
        );
        changed++;
      }
    }
  }

  if (changed > 0) writeFileSync(diskPath, await doc.save());
  return { refs, changed };
}

/** Render the per-manual cross-reference map as a sibling `window.__REFS__` script. */
export function renderRefsIndexJs(refs: { [href: string]: Ref[] }): string {
  return `window.__REFS__ = ${JSON.stringify(refs).replace(/</g, "\\u003c")};`;
}

type RefCache = {
  [href: string]: { mtimeMs: number; refs: Ref[]; relinked: boolean };
};

/**
 * Build the per-manual cross-reference index (`refs-index.js`) over every
 * downloaded page, optionally rewriting in-PDF links to local GoToR targets.
 * Results are cached in `.refs-cache.json` by href + mtime so re-runs only
 * reopen new, changed, or newly-relinked PDFs. Returns a small summary.
 */
export async function buildRefsAndRelink(
  manualDir: string,
  toc: unknown,
  tree: TreeNode[],
  opts: { relinkPdfs: boolean }
): Promise<{ pagesWithRefs: number; relinked: number }> {
  const id = deriveId(toc, manualDir);
  const docMap = buildDocIdMap(toc);

  const cachePath = join(manualDir, ".refs-cache.json");
  let cache: RefCache = {};
  try {
    if (existsSync(cachePath)) cache = JSON.parse(readFileSync(cachePath, "utf8")) as RefCache;
  } catch {
    cache = {};
  }

  const nextCache: RefCache = {};
  const refsMap: { [href: string]: Ref[] } = {};
  let relinked = 0;

  for (const leaf of flattenLeaves(tree)) {
    if (!leaf.href.toLowerCase().endsWith(".pdf")) continue;
    const disk = join(manualDir, ...leaf.href.split("/").map(decodeURIComponent));
    if (!existsSync(disk)) continue;

    const mtimeMs = statSync(disk).mtimeMs;
    const cached = cache[leaf.href];
    const needProcess =
      !cached ||
      cached.mtimeMs !== mtimeMs ||
      (opts.relinkPdfs && !cached.relinked);

    if (!needProcess) {
      nextCache[leaf.href] = cached;
      if (cached.refs.length) refsMap[leaf.href] = cached.refs;
      continue;
    }

    let refs: Ref[] = [];
    let changed = 0;
    try {
      ({ refs, changed } = await processManualPdf(disk, id, docMap, leaf.href, {
        relink: opts.relinkPdfs,
      }));
    } catch {
      refs = [];
      changed = 0;
    }

    const mtimeAfter = changed > 0 ? statSync(disk).mtimeMs : mtimeMs;
    nextCache[leaf.href] = {
      mtimeMs: mtimeAfter,
      refs,
      relinked: (cached?.relinked ?? false) || opts.relinkPdfs,
    };
    if (refs.length) refsMap[leaf.href] = refs;
    if (changed > 0) relinked++;
  }

  writeFileSync(join(manualDir, "refs-index.js"), renderRefsIndexJs(refsMap));
  try {
    writeFileSync(cachePath, JSON.stringify(nextCache));
  } catch {
    /* cache is best-effort */
  }

  return { pagesWithRefs: Object.keys(refsMap).length, relinked };
}
