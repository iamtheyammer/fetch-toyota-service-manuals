import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findIdenticalSizeClusters } from "../src/manual/verify.ts";

/**
 * TIS's "Concurrent Login Alert" is served with HTTP 200 at the requested
 * page's own URL, so it renders to a valid multi-kilobyte PDF that passes every
 * existence and size check. A real run produced 1,914 of them in one manual
 * while verification reported 1915/1915 complete.
 *
 * Every copy renders to an identical byte size, which is the signal: genuine
 * manual pages vary. In a known-good archive of 5,189 pages the largest
 * identical-size group was 14; in the corrupted ones it was 1,914 and 973, both
 * at exactly 27,043 bytes.
 */

describe("findIdenticalSizeClusters", () => {
  const files = (spec: [string, number][]) =>
    spec.map(([path, size]) => ({ path, size }));

  test("flags a large group of identically sized pages", () => {
    const f = files(
      Array.from(
        { length: 40 },
        (_, i) => [`p${i}.pdf`, 27043] as [string, number],
      ),
    );
    const clusters = findIdenticalSizeClusters(f, 20);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].size, 27043);
    assert.equal(clusters[0].files.length, 40);
  });

  test("ignores the small coincidental groups a healthy archive has", () => {
    // Real manuals repeat short boilerplate pages; 14 was the observed maximum
    // across 5,189 verified-good pages.
    const f = files([
      ...Array.from(
        { length: 14 },
        (_, i) => [`a${i}.pdf`, 220824] as [string, number],
      ),
      ...Array.from(
        { length: 7 },
        (_, i) => [`b${i}.pdf`, 69346] as [string, number],
      ),
    ]);
    assert.deepEqual(findIdenticalSizeClusters(f, 20), []);
  });

  test("returns clusters largest first", () => {
    const f = files([
      ...Array.from(
        { length: 25 },
        (_, i) => [`a${i}.pdf`, 100] as [string, number],
      ),
      ...Array.from(
        { length: 60 },
        (_, i) => [`b${i}.pdf`, 200] as [string, number],
      ),
    ]);
    const clusters = findIdenticalSizeClusters(f, 20);
    assert.equal(clusters[0].files.length, 60);
    assert.equal(clusters[1].files.length, 25);
  });

  test("respects the threshold boundary", () => {
    const f = files(
      Array.from(
        { length: 20 },
        (_, i) => [`p${i}.pdf`, 999] as [string, number],
      ),
    );
    assert.equal(findIdenticalSizeClusters(f, 20).length, 1);
    assert.equal(findIdenticalSizeClusters(f, 21).length, 0);
  });

  test("handles an empty archive", () => {
    assert.deepEqual(findIdenticalSizeClusters([], 20), []);
  });
});
