import { Cookie } from "playwright";
import dayjs from "dayjs";
import { jar, TIS_HOST, TIS_ORIGIN } from "./client";

/**
 * Parse a raw "name=value; name2=value2" cookie header into Playwright cookie
 * objects scoped to the TIS host. The `secure` / `SameSite=None` flags are
 * required -- without them the iPlanetDirectoryPro session cookie isn't sent and
 * the session silently fails.
 */
export function parseCookieString(cookieString: string): Cookie[] {
  return cookieString
    .split("; ")
    .filter(Boolean)
    .map((c) => {
      // Split on the FIRST "=" only: cookie values can themselves contain "="
      // (e.g. base64 padding), so a naive split("=") would truncate them.
      const eq = c.indexOf("=");
      return {
        name: c.slice(0, eq),
        value: c.slice(eq + 1),
        domain: TIS_HOST,
        secure: true,
        sameSite: "None",
        path: "/",
        httpOnly: false,
        expires: dayjs().add(1, "day").unix(),
      };
    });
}

/** Add already-parsed cookies to the shared axios cookie jar. */
export function addCookiesToJar(cookies: Cookie[]): void {
  for (const c of cookies) {
    jar.setCookieSync(
      `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}; Expires=${c.expires}; Secure; SameSite=None`,
      `${TIS_ORIGIN}/t3Portal/`
    );
  }
}

/** Parse a raw cookie header and load it into the shared axios cookie jar. */
export function setCookieStringOnJar(cookieString: string): void {
  addCookiesToJar(parseCookieString(cookieString));
}
