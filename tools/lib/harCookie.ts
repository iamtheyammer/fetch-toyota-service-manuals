import { readFileSync, writeFileSync } from "fs";
import { TIS_HOST } from "../../src/api/client";

/**
 * Helpers for reusing a logged-in TIS browser session captured as a HAR file.
 * The downloader and the catalog-lookup tool both authenticate by replaying the
 * `techinfo.toyota.com` cookies the browser sent, rather than performing a
 * (now-unsupported) scripted login.
 */

/**
 * Parse the `techinfo.toyota.com` session cookies out of a browser-exported HAR
 * file (the cookies sent on requests to the TIS host).
 *
 * @returns the assembled `name=value; ...` cookie string and the cookie names.
 * @throws if no `TISESSIONID` is present (the HAR isn't a logged-in TIS session).
 */
export function cookieStringFromHar(harPath: string): {
  cookieString: string;
  names: string[];
} {
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const jar: Record<string, string> = {};
  for (const entry of har.log?.entries ?? []) {
    let host = "";
    try {
      host = new URL(entry.request.url).host;
    } catch {
      continue;
    }
    if (host !== TIS_HOST) continue;
    const header = (entry.request.headers ?? []).find(
      (h: any) => h.name.toLowerCase() === "cookie"
    );
    if (header?.value) {
      for (const pair of String(header.value).split(/;\s*/)) {
        const eq = pair.indexOf("=");
        if (eq > 0) jar[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    }
  }

  const names = Object.keys(jar);
  if (!names.includes("TISESSIONID")) {
    throw new Error(
      `No TISESSIONID cookie found in ${harPath} -- is it a logged-in TIS session capture?`
    );
  }
  return {
    cookieString: names.map((n) => `${n}=${jar[n]}`).join("; "),
    names,
  };
}

/**
 * Resolve a cookie string from either a HAR path or the `TIS_COOKIE` env var.
 * @throws if neither source yields a cookie.
 */
export function resolveCookieString(harPath?: string): string {
  if (harPath) return cookieStringFromHar(harPath).cookieString;
  if (process.env.TIS_COOKIE) return process.env.TIS_COOKIE;
  throw new Error(
    "No TIS cookie: pass --har <path> to a logged-in HAR, or set TIS_COOKIE."
  );
}

/** Assemble a `name=value; ...` cookie string from Playwright cookie records. */
export function cookieStringFromPlaywright(
  cookies: { name: string; value: string }[]
): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Emit a `TIS_COOKIE='...'` shell line for the given cookie string: to a
 * private file at `outPath`, or to stdout when no path is given.
 *
 * When writing a file it uses an **exclusive create** (`flag: "wx"`) so the
 * `0600` mode is actually applied (Node ignores `mode` on an existing file) and
 * a session credential never lands in a pre-existing, possibly world-readable or
 * attacker-controlled file. It refuses (throws) rather than overwrite.
 */
export function emitCookie(cookieString: string, outPath?: string): void {
  // Single-quote for shell `source`; strip any quotes from the value itself.
  const line = `TIS_COOKIE='${cookieString.replace(/'/g, "")}'\n`;

  if (!outPath) {
    process.stdout.write(line);
    return;
  }

  try {
    writeFileSync(outPath, line, { flag: "wx", mode: 0o600 });
  } catch (e: any) {
    if (e.code === "EEXIST") {
      throw new Error(
        `Refusing to write the session cookie to existing file ${outPath} -- ` +
          `remove it first (its permissions/owner cannot be trusted).`
      );
    }
    throw e;
  }
  // Diagnostics to stderr so stdout stays clean if it is being captured.
  process.stderr.write(`Wrote TIS_COOKIE to ${outPath}\n`);
}
