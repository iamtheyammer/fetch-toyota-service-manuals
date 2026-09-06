import { resolve } from "path";

/**
 * Where downloads land when no output directory is given. Kept as the default
 * so existing commands and the documented workflow behave exactly as before.
 */
export const DEFAULT_OUT_DIR = "manuals";

/**
 * Absolute directory a manual's files are written to.
 *
 * Every publication used to be written straight into ./manuals, so downloading
 * a second vehicle interleaved its manuals with the first's and left no record
 * of which car a given publication belonged to. Passing an `outDir` (via
 * `--out-dir`) gives each vehicle its own folder, e.g.
 * manuals/toyota_fj_cruiser/RM12345.
 *
 * `raw` is the manual id plus any @year suffix, without the type prefix -- so
 * `-m cr:BM3900U` lands in BM3900U and `-m RM3900U@2024` in RM3900U@2024.
 */
export function manualDirPath(outDir: string, raw: string): string {
  // resolve() rather than join(".", ...): joining onto "." would swallow the
  // leading slash of an absolute outDir and silently write inside the repo.
  return resolve(outDir || DEFAULT_OUT_DIR, raw);
}
