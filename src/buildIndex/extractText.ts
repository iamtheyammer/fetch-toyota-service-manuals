import { readFileSync } from "fs";
import { PDFParse } from "pdf-parse";

/**
 * Extract and whitespace-normalize the text layer of a PDF for the search index.
 * Returns the text as a single space-separated string. Throws if the PDF can't be
 * parsed (callers decide whether to treat that as "no text").
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const parser = new PDFParse({ data: readFileSync(pdfPath) });
  try {
    const result = await parser.getText();
    return (result.text || "").replace(/\s+/g, " ").trim();
  } finally {
    await parser.destroy();
  }
}
