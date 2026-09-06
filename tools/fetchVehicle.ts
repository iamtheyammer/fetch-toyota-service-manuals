import { spawn } from "child_process";
import commandLineArgs from "command-line-args";
import { resolveCookieString } from "./lib/harCookie.ts";
import {
  collectDocuments,
  downloaderFlag,
  MANUAL_OBJ_TYPES,
} from "./lookupCodes.ts";

/**
 * Download everything for one vehicle with a single command.
 *
 * The full workflow is otherwise four separate steps -- look up the
 * publication codes, copy the ids into `yarn start`, run it twice so per-page
 * timeouts get swept up, then run `download-documents` for the bulletins --
 * with a per-vehicle output directory to remember throughout. Getting any of
 * it wrong is only discovered later, against a paid and time-boxed
 * subscription. This drives the existing tools in the right order instead.
 *
 * Usage:
 *   TIS_COOKIE='...' yarn fetch-vehicle --division LEXUS --model LX600 --year 2024
 *   yarn fetch-vehicle --division TOYOTA --model "FJ Cruiser" --year 2008 \
 *     --har ~/Downloads/techinfo.har --bulletins --archive
 *
 * Everything lands in manuals/<division>_<model>_<year> unless --out-dir says
 * otherwise.
 */

/** Filesystem-safe, lowercase folder name for a vehicle, e.g. lexus_lx600_2024. */
export function vehicleSlug(
  division: string,
  model: string,
  year: string,
): string {
  return [division, model, year]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Run a command, streaming its output, and resolve with its exit code. */
function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    console.log(`\n$ ${cmd} ${args.join(" ")}\n`);
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const opts = commandLineArgs([
    { name: "division", type: String, defaultValue: "TOYOTA" },
    { name: "model", type: String },
    { name: "year", type: String },
    { name: "har", type: String },
    { name: "out-dir", type: String },
    { name: "bulletins", type: Boolean, defaultValue: false },
    { name: "archive", type: Boolean, defaultValue: false },
    { name: "passes", type: Number, defaultValue: 2 },
    { name: "dry-run", type: Boolean, defaultValue: false },
  ]);

  if (!opts.model || !opts.year) {
    console.error(
      "Usage: node tools/fetchVehicle.ts --model <Model> --year <Year> " +
        "[--division TOYOTA] [--har <har-path>] [--out-dir <dir>] " +
        "[--bulletins] [--archive] [--passes 2]\n\n" +
        "Model strings must match TIS exactly (e.g. 'LX600', 'FJ Cruiser'). " +
        "If one is wrong, the error lists every valid option.",
    );
    process.exit(2);
  }

  const cookieString = resolveCookieString(opts.har);
  const outDir =
    opts["out-dir"] ||
    `manuals/${vehicleSlug(opts.division, opts.model, opts.year)}`;

  console.log(
    `Looking up publications for ${opts.division} ${opts.model} ${opts.year}...`,
  );
  const docs = await collectDocuments(
    { division: opts.division, model: opts.model, year: opts.year },
    cookieString,
  );

  const manualFlags = docs
    .filter((d) => MANUAL_OBJ_TYPES.has(d.type))
    .map((d) =>
      downloaderFlag(d.type, d.publicationNumber, opts.year).replace(
        /^-m /,
        "",
      ),
    );
  const standaloneCount = docs.length - manualFlags.length;

  if (!manualFlags.length) {
    console.error(
      `No manual publications found for ${opts.division} ${opts.model} ` +
        `${opts.year}. Check the model string and year.`,
    );
    process.exit(1);
  }

  console.log(`\nFound ${manualFlags.length} manual publication(s):`);
  for (const f of manualFlags) console.log(`  -m ${f}`);
  console.log(
    `and ${standaloneCount} standalone document(s) (TSBs/bulletins).`,
  );
  console.log(`\nOutput directory: ${outDir}`);

  const manualArgs = ["-o", outDir];
  for (const f of manualFlags) manualArgs.push("-m", f);

  if (opts["dry-run"]) {
    console.log("\n--dry-run: would run");
    console.log(
      `  node src/index.ts ${manualArgs.join(" ")}   (x${opts.passes})`,
    );
    if (opts.bulletins) {
      console.log(
        `  node tools/downloadDocuments.ts --division ${opts.division} ` +
          `--model "${opts.model}" --year ${opts.year} --out ${outDir}/_documents`,
      );
    }
    return;
  }

  // Two passes by default: a handful of pages hit a navigation timeout on any
  // long run, and a second pass re-fetches only those (already-downloaded
  // files are skipped).
  for (let pass = 1; pass <= opts.passes; pass++) {
    console.log(`\n=== Manuals, pass ${pass}/${opts.passes} ===`);
    const code = await run("node", ["src/index.ts", ...manualArgs]);
    if (code === 2) {
      console.error(
        "\nTIS session expired. Capture a fresh cookie and re-run this same " +
          "command -- everything already downloaded is kept.",
      );
      process.exit(2);
    }
    if (code !== 0) {
      console.error(`\nDownload failed (exit ${code}).`);
      process.exit(code);
    }
  }

  if (opts.bulletins) {
    for (let pass = 1; pass <= opts.passes; pass++) {
      console.log(`\n=== Bulletins, pass ${pass}/${opts.passes} ===`);
      const code = await run("node", [
        "tools/downloadDocuments.ts",
        "--division",
        opts.division,
        "--model",
        opts.model,
        "--year",
        opts.year,
        "--out",
        `${outDir}/_documents`,
      ]);
      if (code === 2) {
        console.error("\nTIS session expired while fetching bulletins.");
        process.exit(2);
      }
    }
  }

  console.log("\n=== Verifying ===");
  const verifyCode = await run("node", ["tools/verify.ts", "--dir", outDir]);

  if (opts.archive) {
    if (verifyCode !== 0) {
      console.error(
        "\nSkipping --archive: verification found gaps. Re-run this command " +
          "to fetch them, then archive.",
      );
      process.exit(1);
    }
    console.log("\n=== Archiving ===");
    const code = await run("node", ["tools/archive.ts", "--dir", outDir]);
    if (code !== 0) process.exit(code);
  }

  console.log(`\nDone. Files are in ${outDir}`);
  process.exit(verifyCode);
}

if (import.meta.main) {
  // Surface failures as a readable message: an unhandled rejection here prints
  // a stack trace, and the most common cause by far is simply not having a
  // cookie in the environment yet.
  main().catch((e: Error) => {
    console.error(`\nERROR: ${e.message}`);
    process.exit(1);
  });
}
