// Reads the text out of a teacher's uploaded form so the AI can turn it into
// the profile JSON. Runs entirely in the browser: PDFs via pdf.js (loaded on
// demand, so the main bundle stays small), plain-text files directly.

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 40;

export async function extractTextFromFile(file) {
  if (!file) throw new Error("Please choose a file.");
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is too large (over 15 MB). Please upload a smaller PDF.");
  const name = (file.name || "").toLowerCase();
  const type = file.type || "";
  if (type === "application/pdf" || name.endsWith(".pdf")) return extractPdfText(file);
  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) return (await file.text()).trim();
  throw new Error("Please upload a PDF (or a plain text file).");
}

async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new Error("This PDF couldn't be opened. Is the file complete and not password-protected?");
  }

  const pages = [];
  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdf.js returns positioned fragments; rebuild lines from its EOL markers
    // so the AI sees the form roughly as it was laid out.
    const lines = [];
    let line = [];
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      if (item.str.trim()) line.push(item.str.trim());
      if (item.hasEOL) { if (line.length) lines.push(line.join(" ")); line = []; }
    }
    if (line.length) lines.push(line.join(" "));
    pages.push(lines.join("\n"));
  }
  const text = pages.join("\n\n").trim();
  if (!text) {
    throw new Error("This PDF has no readable text — it may be a scanned photo. Please upload a typed PDF, or answer the questions instead.");
  }
  return text;
}
