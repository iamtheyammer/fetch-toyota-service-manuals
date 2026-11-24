import assert from "assert";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { extractPdfText } from "./extractText";

function findPdf(dir: string): string | null {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const f = findPdf(p);
      if (f) return f;
    } else if (name.toLowerCase().endsWith(".pdf")) {
      return p;
    }
  }
  return null;
}

(async () => {
  const manuals = join(__dirname, "..", "..", "manuals");
  const pdf = existsSync(manuals) ? findPdf(manuals) : null;
  if (!pdf) {
    console.log("OK (SKIP: no sample PDF under manuals/)");
    return;
  }
  const text = await extractPdfText(pdf);
  assert.ok(text.length > 0, "extracted text should be non-empty");
  assert.ok(/[a-z]{3,}/i.test(text), "extracted text should contain words");
  assert.ok(!/\s{2,}/.test(text), "whitespace should be normalized to single spaces");
  console.log("OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
