import { existsSync } from "fs";
import { join } from "path";
import sanitizeFilename from "../sanitizeFilename";

/**
 * A node in the normalized browse tree shared by generic and EWD manuals.
 * A node is either a section (has `children`) or a page (has `href`).
 */
export type TreeNode = { label: string; href?: string; children?: TreeNode[] };

/** URL-safe relative link to a saved file: each segment sanitized, then URL-encoded. */
export function fileHref(segments: string[], ext: string): string {
  return segments.map((s) => encodeURIComponent(sanitizeFilename(s))).join("/") + "." + ext;
}

/** Human-readable relative path (sanitized, forward slashes, not URL-encoded). */
export function relPath(segments: string[], ext: string): string {
  return segments.map(sanitizeFilename).join("/") + "." + ext;
}

/** Absolute on-disk path for a saved file, using the OS separator. */
export function diskPath(manualDir: string, segments: string[], ext: string): string {
  return join(manualDir, ...segments.map(sanitizeFilename)) + "." + ext;
}

/**
 * Walk a generic manual's `toc-downloaded.json` object (string value = a leaf
 * page that was PDF'd, nested object = a section) into a TreeNode[], recording
 * any leaf whose PDF is not on disk into `missing` (readable relative paths).
 */
export function collectGenericTree(
  toc: unknown,
  manualDir: string
): { root: TreeNode[]; missing: string[] } {
  const missing: string[] = [];

  function walk(obj: Record<string, unknown>, path: string[]): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const segs = [...path, key];
      if (typeof value === "string") {
        if (!existsSync(diskPath(manualDir, segs, "pdf"))) {
          missing.push(relPath(segs, "pdf"));
        }
        nodes.push({ label: key, href: fileHref(segs, "pdf") });
      } else if (value && typeof value === "object") {
        nodes.push({ label: key, children: walk(value as Record<string, unknown>, segs) });
      }
    }
    return nodes;
  }

  return { root: walk((toc ?? {}) as Record<string, unknown>, []), missing };
}
