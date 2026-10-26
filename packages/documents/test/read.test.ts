import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { formatOf, pageOf, readDocument } from "../src/index.js";

/** A minimal valid PDF with one text line per page (no text at all for a "scan"). */
function pdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const line of pages) {
    const stream = line ? `BT /F1 12 Tf 72 720 Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET` : "";
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(out);
}

function docx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
  });
}

function pptx(slides: string[][]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  slides.forEach((paragraphs, i) => {
    const ps = paragraphs.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join("");
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(`<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>${ps}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  });
  files["ppt/presentation.xml"] = strToU8("<p:presentation/>");
  return zipSync(files);
}

describe("formatOf", () => {
  it("reads the MIME type, else the extension", () => {
    expect(formatOf("application/pdf", "x.bin")).toBe("pdf");
    expect(formatOf(null, "Northwind MSA.DOCX")).toBe("docx");
    expect(formatOf("application/octet-stream", "pricing.xlsx")).toBe("xlsx");
    expect(formatOf("text/csv; charset=utf-8", null)).toBe("csv");
    expect(formatOf("application/zip", "archive.zip")).toBeNull();
    expect(formatOf(null, "old.doc")).toBeNull();
  });
});

describe("readDocument", () => {
  it("reads a PDF page by page, with page markers", async () => {
    const result = await readDocument(pdf(["Master Services Agreement", "We will deliver SSO by November 13, 2026."]), "pdf");
    expect(result.pages).toBe(2);
    expect(result.needsOcr).toBe(false);
    expect(result.text).toContain("[Page 1]\nMaster Services Agreement");
    expect(result.text).toContain("[Page 2]\nWe will deliver SSO by November 13, 2026.");
    expect(pageOf(result.text, "We will deliver SSO by November 13")).toBe(2);
  });

  it("flags a PDF without a text layer for OCR", async () => {
    const result = await readDocument(pdf(["", ""]), "pdf");
    expect(result.needsOcr).toBe(true);
  });

  it("reads Word documents", async () => {
    const result = await readDocument(docx(["Statement of Work", "Kept will provide weekly exports."]), "docx");
    expect(result.text).toBe("Statement of Work\n\nKept will provide weekly exports.");
  });

  it("reads every tab of a workbook, as rows", async () => {
    const wb = new ExcelJS.Workbook();
    const plan = wb.addWorksheet("Rollout");
    plan.addRow(["Milestone", "Owner", "Due"]);
    plan.addRow(["SSO live", "Priya", new Date("2026-11-13T00:00:00Z")]);
    wb.addWorksheet("Pricing").addRow(["Seats", 250, { formula: "B1*1000", result: 250000 }]);
    const result = await readDocument(new Uint8Array(await wb.xlsx.writeBuffer()), "xlsx");
    expect(result.text).toBe("## Sheet: Rollout\nMilestone | Owner | Due\nSSO live | Priya | 2026-11-13\n\n## Sheet: Pricing\nSeats | 250 | 250000");
  });

  it("reads slides in order, with slide markers", async () => {
    const result = await readDocument(pptx([["QBR", "Northwind"], ["Next steps", "SSO by Nov 13 &amp; export fix"]]), "pptx");
    expect(result.pages).toBe(2);
    expect(result.text).toBe("[Slide 1]\nQBR\nNorthwind\n\n[Slide 2]\nNext steps\nSSO by Nov 13 & export fix");
  });

  it("reads HTML as text and marks images for OCR", async () => {
    expect((await readDocument(strToU8("<p>Hello</p><script>x()</script><p>Lina &amp; Marc</p>"), "html")).text).toBe("Hello\n Lina & Marc");
    expect((await readDocument(new Uint8Array([1, 2, 3]), "image")).needsOcr).toBe(true);
  });
});
