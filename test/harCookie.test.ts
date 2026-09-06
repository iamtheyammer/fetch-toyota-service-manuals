import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cookieStringFromHar,
  cookieStringFromPlaywright,
  emitCookie,
} from "../tools/lib/harCookie.ts";

/**
 * Cookie handling is the whole authentication story now that TIS's scripted
 * login is dead, and emitCookie writes a live session credential to disk --
 * so both the extraction rules and the refuse-to-overwrite guard are pinned.
 */

const tmp = () => mkdtempSync(join(tmpdir(), "tis-test-"));

function harFile(entries: unknown[]): string {
  const p = join(tmp(), "capture.har");
  writeFileSync(p, JSON.stringify({ log: { entries } }));
  return p;
}

const entry = (url: string, cookie?: string) => ({
  request: {
    url,
    headers: cookie ? [{ name: "Cookie", value: cookie }] : [],
  },
});

describe("cookieStringFromHar", () => {
  test("extracts TIS cookies and ignores other hosts", () => {
    const har = harFile([
      entry("https://example.com/x", "OTHER=nope"),
      entry(
        "https://techinfo.toyota.com/t3Portal/",
        "TISESSIONID=abc123; foo=bar",
      ),
    ]);
    const { cookieString, names } = cookieStringFromHar(har);
    assert.deepEqual(names.sort(), ["TISESSIONID", "foo"]);
    assert.ok(cookieString.includes("TISESSIONID=abc123"));
    assert.ok(!cookieString.includes("OTHER"));
  });

  test("merges cookies across entries, last value winning", () => {
    const har = harFile([
      entry("https://techinfo.toyota.com/a", "TISESSIONID=old"),
      entry("https://techinfo.toyota.com/b", "TISESSIONID=new; extra=1"),
    ]);
    const { cookieString } = cookieStringFromHar(har);
    assert.ok(cookieString.includes("TISESSIONID=new"));
    assert.ok(!cookieString.includes("old"));
  });

  test("preserves '=' inside a cookie value", () => {
    const har = harFile([
      entry("https://techinfo.toyota.com/a", "TISESSIONID=abc; b64=aGVsbG8="),
    ]);
    assert.ok(cookieStringFromHar(har).cookieString.includes("b64=aGVsbG8="));
  });

  test("is case-insensitive about the Cookie header name", () => {
    const p = join(tmp(), "c.har");
    writeFileSync(
      p,
      JSON.stringify({
        log: {
          entries: [
            {
              request: {
                url: "https://techinfo.toyota.com/a",
                headers: [{ name: "cookie", value: "TISESSIONID=xyz" }],
              },
            },
          ],
        },
      }),
    );
    assert.ok(cookieStringFromHar(p).cookieString.includes("TISESSIONID=xyz"));
  });

  test("throws when the HAR has no TISESSIONID (not a logged-in capture)", () => {
    const har = harFile([entry("https://techinfo.toyota.com/a", "foo=bar")]);
    assert.throws(
      () => cookieStringFromHar(har),
      /No TISESSIONID cookie found/,
    );
  });

  test("skips entries with an unparseable URL", () => {
    const har = harFile([
      entry("not a url", "TISESSIONID=ignored"),
      entry("https://techinfo.toyota.com/a", "TISESSIONID=good"),
    ]);
    assert.ok(
      cookieStringFromHar(har).cookieString.includes("TISESSIONID=good"),
    );
  });
});

describe("cookieStringFromPlaywright", () => {
  test("assembles name=value pairs", () => {
    assert.equal(
      cookieStringFromPlaywright([
        { name: "TISESSIONID", value: "a" },
        { name: "b", value: "c" },
      ]),
      "TISESSIONID=a; b=c",
    );
  });
});

describe("emitCookie", () => {
  test("writes an owner-only (0600) shell line", () => {
    const out = join(tmp(), "tis.env");
    emitCookie("TISESSIONID=secret", out);
    assert.equal(
      readFileSync(out, "utf8"),
      "TIS_COOKIE='TISESSIONID=secret'\n",
    );
    assert.equal(statSync(out).mode & 0o777, 0o600);
  });

  test("refuses to overwrite an existing file rather than trust its mode", () => {
    const out = join(tmp(), "existing.env");
    writeFileSync(out, "pre-existing\n");
    assert.throws(
      () => emitCookie("TISESSIONID=secret", out),
      /Refusing to write the session cookie to existing file/,
    );
    // The credential must not have landed in the untrusted file.
    assert.equal(readFileSync(out, "utf8"), "pre-existing\n");
  });

  test("strips quotes that would break the shell single-quoting", () => {
    const out = join(tmp(), "quoted.env");
    emitCookie("TISESSIONID=a'b", out);
    assert.equal(readFileSync(out, "utf8"), "TIS_COOKIE='TISESSIONID=ab'\n");
  });
});

describe("cookieStringFromHar across multiple sessions", () => {
  // A HAR captured with DevTools "Preserve log" enabled (which the guide tells
  // you to turn on) spans every session the browser had, including expired
  // ones. Unioning cookies across the file replays cookies the browser has
  // since stopped sending -- notably ForgeRock's agent-authn-tx-* transaction
  // cookie from a previous login -- and TIS rejects the result as invalid.
  const entryAt = (time: string, url: string, cookie: string) => ({
    startedDateTime: time,
    request: { url, headers: [{ name: "Cookie", value: cookie }] },
  });

  test("uses only the cookies from the most recent request", () => {
    const har = harFile([
      entryAt(
        "2026-09-05T16:47:08.000-06:00",
        "https://techinfo.toyota.com/a",
        "TISESSIONID=yesterday; agent-authn-tx-OLD=stale; keep=1",
      ),
      entryAt(
        "2026-09-06T08:29:14.000-06:00",
        "https://techinfo.toyota.com/b",
        "TISESSIONID=today; keep=1",
      ),
    ]);
    const { cookieString, names } = cookieStringFromHar(har);
    assert.ok(cookieString.includes("TISESSIONID=today"));
    assert.ok(!cookieString.includes("yesterday"));
    // The stale transaction cookie must not be replayed.
    assert.ok(
      !names.includes("agent-authn-tx-OLD"),
      "stale cookie was included",
    );
    assert.deepEqual(names.sort(), ["TISESSIONID", "keep"]);
  });

  test("orders by timestamp, not file order", () => {
    const har = harFile([
      entryAt(
        "2026-09-06T08:29:14.000-06:00",
        "https://techinfo.toyota.com/b",
        "TISESSIONID=newest",
      ),
      entryAt(
        "2026-09-05T16:47:08.000-06:00",
        "https://techinfo.toyota.com/a",
        "TISESSIONID=older; junk=1",
      ),
    ]);
    const { cookieString } = cookieStringFromHar(har);
    assert.ok(cookieString.includes("TISESSIONID=newest"));
    assert.ok(!cookieString.includes("junk"));
  });

  test("falls back to file order when entries carry no timestamp", () => {
    const har = harFile([
      entry("https://techinfo.toyota.com/a", "TISESSIONID=first"),
      entry("https://techinfo.toyota.com/b", "TISESSIONID=last"),
    ]);
    assert.ok(
      cookieStringFromHar(har).cookieString.includes("TISESSIONID=last"),
    );
  });

  test("skips a most-recent request that has no TISESSIONID", () => {
    // Some late requests (static assets) go out without the session cookie.
    const har = harFile([
      entryAt(
        "2026-09-06T08:00:00.000-06:00",
        "https://techinfo.toyota.com/a",
        "TISESSIONID=real; helper=1",
      ),
      entryAt(
        "2026-09-06T08:30:00.000-06:00",
        "https://techinfo.toyota.com/img",
        "anon=1",
      ),
    ]);
    const { cookieString } = cookieStringFromHar(har);
    assert.ok(cookieString.includes("TISESSIONID=real"));
  });
});
