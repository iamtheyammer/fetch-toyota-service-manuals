import { spawn } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { basename, resolve } from "path";
import commandLineArgs from "command-line-args";

/**
 * Package a downloaded vehicle directory as a single .tar.xz.
 *
 * Usage:
 *   yarn archive --dir manuals/lexus_lx600_2024
 *   yarn archive --dir manuals/toyota_fj_cruiser --out ~/Documents/fj.tar.xz
 *
 * xz settings are chosen from free memory rather than hard-coded. `xz -9e -T0`
 * wants roughly 700 MB per thread, so on a 12-core machine it reaches for ~8 GB
 * and will thrash or be OOM-killed on a busy desktop. Manual pages are already
 * compressed PDFs, so the stronger preset buys very little anyway.
 */

/** Bytes of memory available to us right now, or undefined if unknown. */
function availableMemoryBytes(): number | undefined {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (match) return parseInt(match[1], 10) * 1024;
  } catch {
    // Not Linux, or /proc unavailable -- fall back to a conservative default.
  }
  return undefined;
}

/**
 * xz preset and thread count that fit in the memory actually available.
 * Preset 6 needs roughly 100 MB per thread, preset 9 roughly 700 MB.
 */
export function chooseXzSettings(
  availableBytes: number | undefined,
  cpus: number,
): { preset: string; threads: number } {
  const GB = 1024 ** 3;
  // Leave headroom: never plan to use more than half of what is free.
  const budget = availableBytes === undefined ? 1 * GB : availableBytes / 2;
  const perThread6 = 100 * 1024 * 1024;
  const threads = Math.max(1, Math.min(cpus, Math.floor(budget / perThread6)));
  return { preset: "-6", threads };
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
    child.on("close", (code) => res(code ?? 1));
  });
}

async function main() {
  const opts = commandLineArgs([
    { name: "dir", type: String },
    { name: "out", type: String },
    { name: "name", type: String },
  ]);

  if (!opts.dir) {
    console.error(
      "Usage: node tools/archive.ts --dir <vehicle-dir> [--out <file.tar.xz>] [--name <top-folder>]",
    );
    process.exit(2);
  }
  const dir = resolve(opts.dir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${opts.dir}`);
    process.exit(1);
  }

  const folder = basename(dir);
  // Name the archive's top-level folder, so it never unpacks as a bare
  // "manuals" or scatters into the current directory.
  const name = opts.name || folder;
  const out = resolve(opts.out || `${folder}.tar.xz`);

  const cpus = (await import("os")).cpus().length;
  const { preset, threads } = chooseXzSettings(availableMemoryBytes(), cpus);
  console.log(
    `Archiving ${opts.dir} -> ${out}\n` +
      `  xz ${preset} -T${threads} (chosen for available memory)`,
  );

  // tar streams into xz; --transform renames the top-level folder.
  const code = await run("sh", [
    "-c",
    `tar -cf - -C "${resolve(dir, "..")}" --transform='s,^${folder},${name},' "${folder}" | ` +
      `xz ${preset} -T${threads} -c > "${out}"`,
  ]);
  if (code !== 0) {
    console.error(`Archiving failed (exit ${code}).`);
    process.exit(code);
  }

  console.log("Verifying archive integrity...");
  const testCode = await run("xz", ["-t", out]);
  if (testCode !== 0) {
    console.error("Archive failed its integrity check.");
    process.exit(testCode);
  }

  const size = statSync(out).size / 1024 ** 2;
  console.log(`\nArchive OK: ${out} (${size.toFixed(0)} MB)`);
}

if (import.meta.main) {
  main().catch((e: Error) => {
    console.error(`\nERROR: ${e.message}`);
    process.exit(1);
  });
}
