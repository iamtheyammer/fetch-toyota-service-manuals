import * as fs from "fs";
import * as readline from "readline";
import commandLineArgs from "command-line-args";
import { chromium, Page } from "playwright";
import { TIS_ORIGIN } from "../src/api/client";
import { cookieStringFromPlaywright, emitCookie } from "./lib/harCookie";

/**
 * Mint a fresh TIS session by driving the real browser login, including Toyota's
 * two-factor step. The tool's scripted login can't authenticate against current
 * TIS, and the cookie from a HAR goes stale once the portal session rotates --
 * so this is the autonomous way to (re)obtain a working session cookie.
 *
 * It logs in with TIS_EMAIL / TIS_PASSWORD (env), reaches the "choose a
 * validation method" page, triggers a one-time code to your phone/email, reads
 * the code (interactively from stdin, or from a file via --otp-file), submits
 * it, and emits the resulting `TIS_COOKIE='...'`.
 *
 * Usage:
 *   TIS_EMAIL=you@example.com TIS_PASSWORD=secret \
 *     yarn refresh-session [--method text|email] [--out tis.env] [--otp-file path] [--headed]
 *
 *   # …prompts: "Enter the OTP code sent to your device:"  (unless --otp-file)
 *
 * 2FA requires a human-relayed code, so this cannot be fully unattended; the
 * --otp-file option lets an orchestrator drop the code in for automation.
 *
 * Note: this performs a portal login, which rotates the server-side session and
 * supersedes any previously captured cookie.
 */

const LOGIN_URL = `${TIS_ORIGIN}/t3Portal/`;
// Generous window: when an orchestrator relays the OTP from a human (via
// --otp-file), the round-trip can take several minutes. Toyota's codes stay
// valid long enough that erring large here just avoids needless re-sends.
const OTP_WAIT_MS = 15 * 60 * 1000;

// Settle delays for the various steps of the login/SSO flow. These are the
// values most likely to need tuning if Toyota changes the login.
const CREDENTIALS_SETTLE_MS = 8000; // after submitting username/password
const METHOD_SELECT_SETTLE_MS = 800; // after picking a validation method
const OTP_TRIGGER_SETTLE_MS = 6000; // after triggering the one-time code
const OTP_FILL_SETTLE_MS = 500; // after typing the code, before verifying
const SSO_SETTLE_MS = 3000; // per portal/SSO-handshake settle iteration
const SSO_SETTLE_ITERATIONS = 10;

interface Options {
  method: string;
  out?: string;
  "otp-file"?: string;
  headed: boolean;
}

function atPortal(url: string): boolean {
  return (
    /\/t3Portal\/(\?|$)|_pageLabel=t3_home/.test(url) &&
    !/login|concurrent/i.test(url)
  );
}

/** Click the first control whose visible text/value/alt matches `re` (in-page). */
async function clickByText(page: Page, re: string): Promise<string | null> {
  return page
    .evaluate((reSrc) => {
      const rx = new RegExp(reSrc, "i");
      const els = Array.from(
        document.querySelectorAll(
          "button, input[type=submit], input[type=button], input[type=image], a"
        )
      );
      const hit = els.find((e: any) =>
        rx.test((e.value || e.textContent || e.alt || e.title || "").trim())
      );
      if (hit) {
        (hit as HTMLElement).click();
        return ((hit as any).value || hit.textContent || "")
          .trim()
          .slice(0, 30);
      }
      return null;
    }, re)
    .catch(() => null);
}

/** Read the OTP from a file (polling) or interactively from stdin. */
async function readOtp(otpFile?: string): Promise<string> {
  if (otpFile) {
    const start = Date.now();
    while (Date.now() - start < OTP_WAIT_MS) {
      if (fs.existsSync(otpFile)) {
        const value = fs.readFileSync(otpFile, "utf8").trim();
        if (value) {
          fs.rmSync(otpFile, { force: true });
          return value;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Timed out waiting for an OTP in ${otpFile}`);
  }
  // Interactive: prompt on stderr so stdout stays clean for the cookie output.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) =>
    rl.question("Enter the OTP code sent to your device: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function main() {
  const opts = commandLineArgs([
    { name: "method", type: String, defaultValue: "text" },
    { name: "out", type: String },
    { name: "otp-file", type: String },
    { name: "headed", type: Boolean, defaultValue: false },
  ]) as Options;

  const email = process.env.TIS_EMAIL;
  const password = process.env.TIS_PASSWORD;
  if (!email || !password) {
    console.error("Set TIS_EMAIL and TIS_PASSWORD in the environment.");
    process.exit(2);
  }
  const methodRe = /^email/i.test(opts.method) ? /email to/i : /text to/i;

  const browser = await chromium.launch({ headless: !opts.headed });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  try {
    // 1. Credentials. The submit is an image button that won't take a synthetic
    //    click headless, but pressing Enter in the password field submits.
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[name="username"]', { state: "visible" });
    await page.fill('input[name="username"]', email);
    await page.fill('input[name="password"]', password);
    await page.press('input[name="password"]', "Enter");
    await page.waitForTimeout(CREDENTIALS_SETTLE_MS);

    // 2. Choose the validation method and trigger the one-time code.
    await page
      .evaluate((reSrc) => {
        const rx = new RegExp(reSrc, "i");
        for (const r of Array.from(
          document.querySelectorAll("input[type=radio]")
        )) {
          const label =
            (r.closest("label") && r.closest("label")!.textContent) ||
            (r.parentElement && r.parentElement.textContent) ||
            "";
          if (rx.test(label)) {
            (r as HTMLInputElement).checked = true;
            (r as HTMLElement).click();
            return;
          }
        }
      }, methodRe.source)
      .catch(() => {});
    await page.waitForTimeout(METHOD_SELECT_SETTLE_MS);
    await clickByText(page, "log ?in|send|continue|submit|next");
    await page.waitForTimeout(OTP_TRIGGER_SETTLE_MS);

    if (atPortal(page.url())) {
      // No 2FA was required (e.g. a remembered device) -- already in.
    } else {
      // 3. Collect the code and submit it.
      console.error("A one-time code was sent. Waiting for it...");
      const otp = await readOtp(opts["otp-file"]);
      const otpField = page
        .locator(
          "input[type=text]:visible, input[type=number]:visible, input[type=tel]:visible, input[type=password]:visible"
        )
        .first();
      await otpField.fill(otp);
      await page.waitForTimeout(OTP_FILL_SETTLE_MS);
      const verified = await clickByText(
        page,
        "verify|log ?in|submit|continue|confirm|next"
      );
      if (!verified) await otpField.press("Enter").catch(() => {});

      // 4. Settle through the SSO handshake to the portal.
      for (let i = 0; i < SSO_SETTLE_ITERATIONS; i++) {
        await page.waitForTimeout(SSO_SETTLE_MS);
        if (atPortal(page.url())) break;
        await clickByText(page, "continue|accept|agree|proceed|^yes$|ok\\b");
      }
      if (!atPortal(page.url())) {
        await page
          .goto(LOGIN_URL, { waitUntil: "domcontentloaded" })
          .catch(() => {});
        await page.waitForTimeout(SSO_SETTLE_MS);
      }
    }

    const cookies = await ctx.cookies(`${TIS_ORIGIN}/`);
    if (
      !cookies.some((c) => c.name === "TISESSIONID") ||
      !atPortal(page.url())
    ) {
      throw new Error(
        `Login did not complete (url=${page.url()}). The code may have been wrong or expired.`
      );
    }

    emitCookie(cookieStringFromPlaywright(cookies), opts.out);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
