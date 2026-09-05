import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { selectAndSettle } from "../../tools/lookupCodes.ts";

/**
 * The TIS catalog form is three cascading <select>s (division -> model -> year),
 * and a wrong model string is the most likely way a lookup-codes run fails.
 * Playwright reports only a 30-second timeout for that, never what the dropdown
 * offered, which is an expensive dead end against a time-boxed subscription --
 * so selectAndSettle enumerates the real options instead.
 *
 * These run against a local page in a real browser: no network, no TIS session.
 * They skip if Chromium has not been installed (`yarn playwright-setup`).
 */

let browser: Browser | undefined;
let page: Page | undefined;

before(async () => {
  try {
    browser = await chromium.launch();
    page = await browser.newPage();
    // Two of these cases deliberately wait out a failed match. Production uses
    // Playwright's 30s default (the cascading dropdowns need that much); the
    // tests only need to observe the failure, so shorten it.
    page.setDefaultTimeout(2000);
  } catch {
    // Chromium not installed -- tests below skip.
  }
});

after(async () => {
  await browser?.close();
});

// Mirrors the TIS form: option values differ from the labels a human would use.
const FORM = `
  <select name="repairformwlw-select_key:{actionForm.model}">
    <option value="">--</option>
    <option value="LX600">LX 600</option>
    <option value="0412">RX 350</option>
  </select>`;
const FIELD = "repairformwlw-select_key:{actionForm.model}";

describe("selectAndSettle", () => {
  test("selects by the option's value attribute", async (t) => {
    if (!page) return t.skip("chromium not installed");
    await page.setContent(FORM);
    await selectAndSettle(page, FIELD, "LX600");
    assert.equal(await page.inputValue(`select[name="${FIELD}"]`), "LX600");
  });

  test("selects by the visible label too", async (t) => {
    if (!page) return t.skip("chromium not installed");
    await page.setContent(FORM);
    // "LX 600" is the label; the value is "LX600". Both must work, because a
    // user reads the label off the TIS page.
    await selectAndSettle(page, FIELD, "LX 600");
    assert.equal(await page.inputValue(`select[name="${FIELD}"]`), "LX600");
  });

  test("a wrong value reports the options that WERE available", async (t) => {
    if (!page) return t.skip("chromium not installed");
    await page.setContent(FORM);
    await assert.rejects(
      () => selectAndSettle(page!, FIELD, "LX-600 Luxury"),
      (e: Error) => {
        assert.match(e.message, /Could not select/);
        assert.match(e.message, /Available options:/);
        // Both the value and its differing label must be shown.
        assert.match(e.message, /LX600 \("LX 600"\)/);
        assert.match(e.message, /0412 \("RX 350"\)/);
        return true;
      },
    );
  });

  test("says so when the cascading dropdown has not populated", async (t) => {
    if (!page) return t.skip("chromium not installed");
    await page.setContent(
      `<select name="${FIELD}"><option value="">--</option></select>`,
    );
    await assert.rejects(
      () => selectAndSettle(page!, FIELD, "LX600"),
      /had no options/,
    );
  });
});
