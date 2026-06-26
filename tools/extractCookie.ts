import { cookieStringFromHar, emitCookie } from "./lib/harCookie";

/**
 * Extract the TIS session cookie from a browser-exported HAR file so it can be
 * fed to the downloader (via the `TIS_COOKIE` env var or the `-c` flag).
 *
 * Usage:
 *   ts-node tools/extractCookie.ts <har-path>                 # print TIS_COOKIE='...' to stdout
 *   ts-node tools/extractCookie.ts <har-path> <out-env-file>  # write it to a 0600 file to `source`
 *
 * The env-file form is preferred: it keeps the cookie out of your shell history
 * and process listings. Example:
 *   ts-node tools/extractCookie.ts ~/Downloads/techinfo.har /tmp/tis.env
 *   set -a; . /tmp/tis.env; set +a; rm -f /tmp/tis.env
 */
function main(): void {
  const [harPath, outPath] = process.argv.slice(2);
  if (!harPath) {
    console.error(
      "Usage: ts-node tools/extractCookie.ts <har-path> [out-env-file]"
    );
    process.exit(2);
  }

  const { cookieString, names } = cookieStringFromHar(harPath);
  emitCookie(cookieString, outPath);
  if (outPath) {
    console.error(`Cookies: ${names.join(", ")}`);
  }
}

main();
