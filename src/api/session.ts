/**
 * Helpers for detecting when a TIS session has expired mid-download.
 *
 * When the session cookie stops being valid, TIS does not return an error
 * status -- it returns HTTP 200 with the SSO/login page (for browser
 * navigations) or an HTML login document (for API/XML requests). Without these
 * guards the downloader would silently save thousands of login pages as if they
 * were real manual content, so we detect the condition and abort cleanly.
 */

/**
 * True if a Playwright navigation landed on the TIS SSO/login flow instead of
 * the requested document (i.e. the session is no longer authenticated).
 *
 * Detection is URL-based because generic manual *pages* are themselves xhtml,
 * so sniffing their body for HTML would false-positive. Use this on the
 * resolved page URL; use {@link looksLikeLoginPage} only for endpoints that
 * should never return HTML (the EWD XML/PDF/SVGZ endpoints).
 */
export function isLoginRedirectUrl(url: string): boolean {
  return (
    url.includes("custom-login-response") ||
    url.includes("/appmanager/") ||
    url.includes("_pageLabel=ti_home_page") ||
    url.includes("/openam/") ||
    url.includes("/agent/custom-login")
  );
}

/**
 * Number of leading characters of a response body inspected when sniffing for
 * an HTML login page. The login markers always appear at the very top of the
 * document, so a small prefix is sufficient.
 */
const LOGIN_PAGE_SNIFF_LENGTH = 500;

/**
 * True if a response body that is supposed to be XML/PDF/SVGZ is actually an
 * HTML login page -- used for the EWD endpoints and the legacy `toc.xml`, which
 * never legitimately return HTML.
 *
 * Do NOT use this on endpoints that legitimately return HTML (e.g. the legacy
 * xhtml page wrappers) -- it would false-positive on valid content. Use
 * {@link looksLikeSessionLost} there instead.
 */
export function looksLikeLoginPage(body: string): boolean {
  const head = String(body).slice(0, LOGIN_PAGE_SNIFF_LENGTH).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("custom-login-response")
  );
}

/**
 * True if a response body is one of TIS's specific session-loss pages (expired
 * session, SSO bounce, or the one-session "concurrent login" guard).
 *
 * Unlike {@link looksLikeLoginPage} this does NOT flag generic HTML, so it is
 * safe on endpoints that legitimately return HTML -- e.g. the legacy xhtml page
 * wrappers, whose valid content is XHTML.
 */
export function looksLikeSessionLost(body: string): boolean {
  const head = String(body).slice(0, 1500).toLowerCase();
  return (
    head.includes("concurrentloginfailure") ||
    head.includes("custom-login-response") ||
    head.includes("/openam/") ||
    head.includes("x-openam") ||
    head.includes("j_security_check")
  );
}

/** Thrown to abort the whole run the moment a session expiry is detected. */
export class SessionExpiredError extends Error {
  constructor() {
    super(
      "TIS session appears to have expired (redirected to the login page). " +
        "Grab a fresh cookie and re-run -- already-downloaded files are skipped.",
    );
    this.name = "SessionExpiredError";
  }
}

/**
 * Distinctive wording of TIS's "Concurrent Login Alert" interstitial.
 *
 * Deliberately specific. A repair page may legitimately mention logging in
 * (dealer tools, Techstream), so matching a bare "login" would discard real
 * content.
 */
const CONCURRENT_LOGIN_MARKERS = [
  "concurrent login alert",
  "someone has logged into the system",
];

/**
 * True if a *rendered page* is TIS's concurrent-login interstitial rather than
 * the requested document.
 *
 * This is not the same condition as {@link isLoginRedirectUrl}. TIS serves this
 * alert with HTTP 200 at the requested page's own URL -- there is no redirect
 * to notice -- so a URL check passes and the page renders to a valid,
 * multi-kilobyte PDF. Existence and size checks then pass too, which is how a
 * run can report every page present while a large share of the archive is the
 * same warning page. The content is the only signal.
 *
 * It fires whenever another session is opened for the account mid-run, which
 * includes TIS rotating the session id out from under the browser context.
 */
export function looksLikeConcurrentLoginPage(html: string): boolean {
  const text = String(html).toLowerCase();
  return CONCURRENT_LOGIN_MARKERS.some((m) => text.includes(m));
}

/** Thrown when TIS serves the concurrent-login interstitial instead of a page. */
export class ConcurrentLoginError extends Error {
  constructor() {
    super(
      'TIS served its "Concurrent Login Alert" instead of the requested page: ' +
        "another session was opened for this account (or TIS rotated the session). " +
        "Close every TIS tab, capture a fresh cookie and re-run -- pages already " +
        "downloaded are skipped, and any alert pages saved by an earlier run are " +
        "detected and replaced.",
    );
    this.name = "ConcurrentLoginError";
  }
}
