import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { gunzipSync } from "zlib";
import { TreeNode, fileHref, relPath, diskPath } from "./tree";

const PARTS = ["system", "routing", "overall"] as const;

/**
 * Produce a sibling `.svg` for a `.svgz` so it renders from `file://` (browsers
 * treat a `.svgz` as gzip and won't render it inline). The bytes are gunzipped
 * only when actually gzip-compressed (magic `1f 8b`); this tool's axios client
 * already decodes the transport-layer gzip, so most saved `.svgz` are in fact
 * plain SVG and are copied as-is. Idempotent: a no-op if the `.svg` already
 * exists or the `.svgz` source is missing.
 */
export function ensureSvg(svgzPath: string): void {
  if (!svgzPath.toLowerCase().endsWith(".svgz")) return;
  const svgPath = svgzPath.slice(0, -".svgz".length) + ".svg";
  if (existsSync(svgPath) || !existsSync(svgzPath)) return;
  const raw = readFileSync(svgzPath);
  const isGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  writeFileSync(svgPath, isGzip ? gunzipSync(raw) : raw);
}

/**
 * Build the browse tree for an EWD (EM) manual: one group per existing part
 * (`system` / `routing` / `overall`), each a flat list from `<part>/title.json`.
 * `overall` entries are PDFs; `system`/`routing` entries are SVGZ, decompressed
 * to SVG and linked as `.svg`. Missing source files are recorded (readable paths).
 */
export function collectEwdTree(manualDir: string): { root: TreeNode[]; missing: string[] } {
  const missing: string[] = [];
  const root: TreeNode[] = [];

  for (const part of PARTS) {
    const titlePath = join(manualDir, part, "title.json");
    if (!existsSync(titlePath)) continue;

    const files = JSON.parse(readFileSync(titlePath, "utf8")) as Record<string, string>;
    const children: TreeNode[] = [];

    for (const name of Object.keys(files)) {
      const srcExt = (files[name].split(".")[1] || "pdf").toLowerCase();
      const segs = [part, name];

      if (srcExt === "svgz") {
        const svgzDisk = diskPath(manualDir, segs, "svgz");
        if (existsSync(svgzDisk)) {
          ensureSvg(svgzDisk);
        } else {
          missing.push(relPath(segs, "svgz"));
        }
        children.push({ label: name, href: fileHref(segs, "svg") });
      } else {
        if (!existsSync(diskPath(manualDir, segs, srcExt))) {
          missing.push(relPath(segs, srcExt));
        }
        children.push({ label: name, href: fileHref(segs, srcExt) });
      }
    }

    root.push({ label: part, children });
  }

  return { root, missing };
}
