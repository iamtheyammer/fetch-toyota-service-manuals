import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCookieString, setCookieStringOnJar } from "../src/api/cookies.ts";
import { jar, TIS_HOST, TIS_ORIGIN } from "../src/api/client.ts";

/**
 * The cookie jar is the authentication seam: the browser does the login, and
 * every subsequent HTTP download is authorised purely by what lands in this
 * jar. It spans axios, axios-cookiejar-support and tough-cookie, so these
 * tests exist to catch a silent auth break across those upgrades -- the
 * failure mode is HTTP 200 login pages saved as manual content, not an error.
 */

describe("parseCookieString", () => {
  test("parses a browser-style '; '-separated cookie header", () => {
    const cookies = parseCookieString("TISESSIONID=abc123; other=value");
    assert.equal(cookies.length, 2);
    assert.equal(cookies[0].name, "TISESSIONID");
    assert.equal(cookies[0].value, "abc123");
    assert.equal(cookies[1].name, "other");
    assert.equal(cookies[1].value, "value");
  });

  test("splits on the FIRST '=' so base64 values survive intact", () => {
    const [cookie] = parseCookieString("token=aGVsbG8gd29ybGQ=");
    assert.equal(cookie.name, "token");
    assert.equal(cookie.value, "aGVsbG8gd29ybGQ=");
  });

  test("scopes cookies to the TIS host with the flags TIS requires", () => {
    // Without secure + SameSite=None the session cookie is not sent and the
    // session fails silently.
    const [cookie] = parseCookieString("TISESSIONID=abc");
    assert.equal(cookie.domain, TIS_HOST);
    assert.equal(cookie.path, "/");
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, "None");
  });

  test("sets an expiry in the future", () => {
    const [cookie] = parseCookieString("TISESSIONID=abc");
    assert.ok(cookie.expires > Date.now() / 1000);
  });

  test("ignores empty segments from a trailing separator", () => {
    assert.equal(parseCookieString("TISESSIONID=abc; ").length, 1);
  });
});

describe("setCookieStringOnJar", () => {
  test("makes the session cookie retrievable for TIS requests", () => {
    setCookieStringOnJar("TISESSIONID=jarvalue; helper=2");
    const sent = jar.getCookieStringSync(`${TIS_ORIGIN}/t3Portal/external/en/`);
    assert.match(sent, /TISESSIONID=jarvalue/);
    assert.match(sent, /helper=2/);
  });

  test("does not leak TIS cookies to other hosts", () => {
    setCookieStringOnJar("TISESSIONID=jarvalue");
    assert.equal(jar.getCookieStringSync("https://example.com/"), "");
  });
});
