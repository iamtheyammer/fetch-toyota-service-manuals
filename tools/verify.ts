import { existsSync, readdirSync } from "fs";
import { join } from "path";
import commandLineArgs from "command-line-args";
import { verifyManualDir, verifyEwdDir } from "../src/manual/verify.ts";
import { DEFAULT_OUT_DIR } from "../src/manual/paths.ts";

/**
 * Check downloaded manuals against their own tables of contents.
 *
 * A partial download is indistinguishable from a complete one at a glance:
 * TIS answers an expired session with HTTP 200 and a login page, so pages can
 * silently stop arriving, and a saved login page looks like a real file until
 * its size is checked. This counts both.
 *
 * Usage:
 *   yarn verify                                  # every manual under ./manuals
 *   yarn verify --dir manuals/toyota_fj_cruiser  # one vehicle
 *
 * Exit code 0 if everything is complete, 1 if anything is missing -- so it can
 * gate an archive step in a script.
 */

interface Found {
  dir: string;
  kind: "manual" | "ewd";
}

/** True if dir looks like an EWD: part subdirectories carrying title.json. */
function isEwdDir(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some(
    (e) => e.isDirectory() && existsSync(join(dir, e.name, "title.json")),
  );
}

/**
 * Publication directories under `root`. Generic manuals are identified by their
 * toc-downloaded.json and EWDs by their per-part title.json, so a vehicle's
 * wiring diagrams are checked rather than silently passed over.
 */
function findPublicationDirs(root: string): Found[] {
  if (!existsSync(root)) return [];
  const found: Found[] = [];
  const walk = (dir: string) => {
    if (existsSync(join(dir, "toc-downloaded.json"))) {
      found.push({ dir, kind: "manual" });
      return; // publications don't nest inside each other
    }
    if (isEwdDir(dir)) {
      found.push({ dir, kind: "ewd" });
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  walk(root);
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

function main() {
  const opts = commandLineArgs([
    { name: "dir", type: String, defaultValue: DEFAULT_OUT_DIR },
    { name: "quiet", type: Boolean, defaultValue: false },
  ]);

  const dirs = findPublicationDirs(opts.dir);
  if (!dirs.length) {
    console.error(
      `No publications found under ${opts.dir} (looked for directories ` +
        `containing toc-downloaded.json, or EWD parts containing title.json).`,
    );
    process.exit(1);
  }

  let allComplete = true;
  let totalLeaves = 0;
  let totalPresent = 0;

  for (const { dir, kind } of dirs) {
    const r = kind === "ewd" ? verifyEwdDir(dir) : verifyManualDir(dir);
    totalLeaves += r.leaves;
    totalPresent += r.present;
    const pct = r.leaves ? ((r.present / r.leaves) * 100).toFixed(1) : "0.0";
    const status = r.complete ? "OK  " : "GAPS";
    console.log(
      `${status} ${dir}${kind === "ewd" ? " [ewd]" : ""}  ` +
        `${r.present}/${r.leaves} (${pct}%)` +
        (r.missing.length ? `  missing=${r.missing.length}` : "") +
        (r.stubs.length ? `  stubs=${r.stubs.length}` : ""),
    );
    if (!r.complete) {
      allComplete = false;
      if (!opts.quiet) {
        for (const m of r.missing.slice(0, 10))
          console.log(`       missing: ${m}`);
        if (r.missing.length > 10)
          console.log(`       ... and ${r.missing.length - 10} more missing`);
        for (const s of r.stubs.slice(0, 10))
          console.log(`       stub:    ${s}`);
        if (r.stubs.length > 10)
          console.log(`       ... and ${r.stubs.length - 10} more stubs`);
      }
    }
  }

  const pct = totalLeaves
    ? ((totalPresent / totalLeaves) * 100).toFixed(1)
    : "0.0";
  console.log(
    `\n${dirs.length} publication(s): ${totalPresent}/${totalLeaves} files (${pct}%)`,
  );
  if (allComplete) {
    console.log("All publications are complete.");
    process.exit(0);
  }
  console.log(
    "Some pages are missing. Re-run the same download command -- already " +
      "downloaded files are skipped, so it only fetches the gaps.",
  );
  process.exit(1);
}

if (import.meta.main) main();
