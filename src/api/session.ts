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
        "Grab a fresh cookie and re-run -- already-downloaded files are skipped."
    );
    this.name = "SessionExpiredError";
  }
}
