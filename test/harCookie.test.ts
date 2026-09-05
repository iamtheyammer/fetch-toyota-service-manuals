import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cookieStringFromHar,
  cookieStringFromPlaywright,
  emitCookie,
} from "../tools/lib/harCookie";

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
