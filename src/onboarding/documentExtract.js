// Turns a teacher's uploaded form into something the AI can read. Runs
// entirely in the browser:
//   • a PDF with a text layer  → its text
//   • a scanned/photographed PDF (no text layer) → page images for the vision
//     model to read, handwriting included
//   • a photo of the form (JPEG/PNG/WebP) → that image
//   • a plain-text file → its text
// pdf.js is loaded on demand so the main bundle stays small.

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_PAGES = 40;
// Page images are expensive to send and to read — a filled form is a few
// pages, and the server caps the request at the same number.
const MAX_IMAGE_PAGES = 8;
// Below this many characters a PDF is treated as scanned rather than typed:
// scanned pages often carry a few stray characters (a header, a page number).
const TEXT_LAYER_MIN_CHARS = 120;
const IMAGE_MAX_EDGE = 1600;
const JPEG_QUALITY = 0.75;

// Returns { kind: "text" | "images", text, images, pageCount }.
export async function extractFromFile(file, onProgress = () => {}) {
  if (!file) throw new Error("Please choose a file.");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("That file is too large (over 25 MB). Please upload a smaller file.");
  }
  const name = (file.name || "").toLowerCase();
  const type = file.type || "";

  if (type === "application/pdf" || name.endsWith(".pdf")) return extractFromPdf(file, onProgress);
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(name)) {
    onProgress("Reading your photo…");
    return { kind: "images", text: "", images: [await imageFileToDataUrl(file)], pageCount: 1 };
  }
  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("That file is empty.");
    return { kind: "text", text, images: [], pageCount: 1 };
  }
  throw new Error("Please upload a PDF, a photo of your form, or a text file.");
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function extractFromPdf(file, onProgress) {
  onProgress("Opening your form…");
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new Error("This PDF couldn't be opened. Is the file complete and not password-protected?");
  }

  // 1. Try the text layer.
  const pages = [];
  const textPages = Math.min(doc.numPages, MAX_TEXT_PAGES);
  for (let i = 1; i <= textPages; i++) {
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
  if (text.length >= TEXT_LAYER_MIN_CHARS) {
    return { kind: "text", text, images: [], pageCount: doc.numPages };
  }

  // 2. No usable text layer — it's a scan or a photo. Render the pages so the
  //    vision model can read them.
  const imagePages = Math.min(doc.numPages, MAX_IMAGE_PAGES);
  const images = [];
  for (let i = 1; i <= imagePages; i++) {
    onProgress(`Reading page ${i} of ${imagePages}…`);
    images.push(await renderPdfPage(doc, i));
  }
  if (!images.length) {
    throw new Error("This PDF has no readable pages. Please try another file, or answer the questions instead.");
  }
  return { kind: "images", text, images, pageCount: doc.numPages };
}

async function renderPdfPage(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(IMAGE_MAX_EDGE / Math.max(base.width, base.height), 3);
  const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext("2d");
  // Scans are usually white paper; fill first so transparency doesn't turn black.
  canvasContext.fillStyle = "#ffffff";
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext, viewport }).promise;
  const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  // Free the backing store promptly — eight full-page canvases add up on a phone.
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

async function imageFileToDataUrl(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image couldn't be opened. Please upload a JPEG or PNG photo, or a PDF.");
  }
  const scale = Math.min(IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.8);
  canvas.width = 0;
  canvas.height = 0;
  return url;
}
