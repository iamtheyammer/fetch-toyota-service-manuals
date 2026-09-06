import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isLoginRedirectUrl,
  looksLikeLoginPage,
  looksLikeSessionLost,
  looksLikeConcurrentLoginPage,
  SessionExpiredError,
} from "../src/api/session.ts";

/**
 * Session-expiry detection is the guard that stops a lapsed cookie from being
 * silently written to disk as thousands of "manual" pages: TIS answers an
 * expired session with HTTP 200 and a login document, not an error status.
 * A false negative here corrupts a whole download run and is only noticed
 * afterwards, so the three detectors are pinned here.
 */

describe("isLoginRedirectUrl", () => {
  const redirects = [
    "https://techinfo.toyota.com/t3Portal/custom-login-response",
    "https://techinfo.toyota.com/appmanager/t3/ti",
    "https://techinfo.toyota.com/t3Portal/?_pageLabel=ti_home_page",
    "https://techinfo.toyota.com/openam/XUI/",
    "https://techinfo.toyota.com/agent/custom-login",
  ];
  for (const url of redirects) {
    test(`flags ${new URL(url).pathname + new URL(url).search}`, () => {
      assert.equal(isLoginRedirectUrl(url), true);
    });
  }

  test("does not flag a real manual page URL", () => {
    assert.equal(
      isLoginRedirectUrl(
        "https://techinfo.toyota.com/t3Portal/external/en/rm/RM36Q0U/xhtml/RM000000XYZ.html",
      ),
      false,
    );
  });
});

describe("looksLikeLoginPage", () => {
  // Only for endpoints that never legitimately return HTML (EWD XML/PDF/SVGZ
  // and the legacy toc.xml) -- there, any HTML at all means a login bounce.
  test("flags an HTML document where XML was expected", () => {
    assert.equal(looksLikeLoginPage("<!DOCTYPE html><html><body>"), true);
    assert.equal(looksLikeLoginPage("<html lang='en'>"), true);
  });

  test("accepts real XML content", () => {
    assert.equal(
      looksLikeLoginPage(
        '<?xml version="1.0"?><xmltoc><name>RM</name></xmltoc>',
      ),
      false,
    );
  });

  test("only sniffs the head of the body", () => {
    // A "<html" appearing far into a large XML payload must not trip this.
    const xml = `<?xml version="1.0"?><xmltoc>${" ".repeat(600)}<html></xmltoc>`;
    assert.equal(looksLikeLoginPage(xml), false);
  });
});

describe("looksLikeSessionLost", () => {
  // Safe on endpoints whose valid content IS html (the legacy xhtml page
  // wrappers), so it must match TIS's specific session-loss markers only.
  test("flags the concurrent-login guard", () => {
    assert.equal(
      looksLikeSessionLost("<html><head><title>concurrentLoginFailure</title>"),
      true,
    );
  });

  test("flags SSO bounce markers", () => {
    assert.equal(
      looksLikeSessionLost("<html>...custom-login-response..."),
      true,
    );
    assert.equal(
      looksLikeSessionLost("<html>...<a href='/openam/XUI/'>"),
      true,
    );
    assert.equal(looksLikeSessionLost("<html>x-openam-password"), true);
    assert.equal(
      looksLikeSessionLost("<form action='/j_security_check'>"),
      true,
    );
  });

  test("does NOT flag a valid legacy xhtml page wrapper", () => {
    const wrapper =
      '<html><head><link rel="pdf" href="/t3Portal/document/rm/RM123/pdf/A.pdf"/></head><body/></html>';
    assert.equal(looksLikeSessionLost(wrapper), false);
  });
});

describe("SessionExpiredError", () => {
  test("is identifiable by instanceof (drives exit code 2)", () => {
    const e = new SessionExpiredError();
    assert.ok(e instanceof SessionExpiredError);
    assert.ok(e instanceof Error);
    assert.equal(e.name, "SessionExpiredError");
    assert.match(e.message, /session appears to have expired/i);
  });
});

describe("looksLikeConcurrentLoginPage", () => {
  /**
   * The failure this exists to stop: TIS serves its "Concurrent Login Alert"
   * interstitial with HTTP 200 *at the requested page's own URL*, so a
   * URL-based check sees nothing wrong and Playwright renders the alert to a
   * PDF that is a perfectly valid, multi-kilobyte file. Size and existence
   * checks all pass, so a run reports 100% complete while a quarter of the
   * archive is the same warning page.
   */
  const ALERT = `<html><head><title>TIS</title></head><body>
    <h1>Concurrent Login Alert</h1>
    <p>Someone has logged into the system using your username and password.</p>
    <p>Password access to this system is limited to an single user for each user ID.</p>
    </body></html>`;

  test("flags the concurrent login interstitial", () => {
    assert.equal(looksLikeConcurrentLoginPage(ALERT), true);
  });

  test("flags it by the body sentence alone, without the heading", () => {
    assert.equal(
      looksLikeConcurrentLoginPage(
        "<html><body>Someone has logged into the system using your username and password.</body></html>",
      ),
      true,
    );
  });

  test("is case-insensitive", () => {
    assert.equal(
      looksLikeConcurrentLoginPage(
        "<html><body>CONCURRENT LOGIN ALERT</body></html>",
      ),
      true,
    );
  });

  test("does not flag a real manual page", () => {
    const real = `<html><body><h1>COMPONENTS</h1>
      <p>2008 MY FJ Cruiser [07-2007 - ]</p>
      <table><tr><td>CLUTCH ACCUMULATOR ASSEMBLY</td></tr></table>
      </body></html>`;
    assert.equal(looksLikeConcurrentLoginPage(real), false);
  });

  test("does not flag a page that merely mentions login in passing", () => {
    // A repair page could legitimately discuss a "login" procedure for a
    // vehicle system; only the specific alert wording counts.
    assert.equal(
      looksLikeConcurrentLoginPage(
        "<html><body>Perform the dealer login procedure on Techstream.</body></html>",
      ),
      false,
    );
  });
});
