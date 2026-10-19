/*
 * Zuglak Studio 2.0 – minimal, dependency-free PDF writer.
 * Produces a one-page PDF embedding a JPEG image (DCTDecode) at the given
 * paper size. The plan, title block and furniture list are rendered into the
 * image beforehand, so the PDF matches the PNG export exactly.
 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZuglakPdf = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PAPER = Object.freeze({ a4: [841.89, 595.28], a3: [1190.55, 841.89], square: [841.89, 841.89] });

  function jpegSize(bytes) {
    // Scan JPEG markers for SOF0/SOF2 to read the pixel size.
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8] };
      }
      offset += 2 + length;
    }
    throw new TypeError('Érvénytelen JPEG adat.');
  }

  function asciiBytes(text) {
    const out = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
    return out;
  }

  /** Escapes a PDF string using UTF-16BE hex so Hungarian titles survive. */
  function pdfText(value) {
    let hex = 'FEFF';
    for (const ch of String(value || '')) {
      const code = ch.codePointAt(0);
      if (code > 0xffff) continue;
      hex += code.toString(16).padStart(4, '0').toUpperCase();
    }
    return `<${hex}>`;
  }

  function createImagePdf({ jpeg, paper = 'a4', title = 'Zuglak Studio', author = 'Zuglak Studio 2.0', date = new Date() }) {
    const bytes = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
    const size = jpegSize(bytes);
    const [pageW, pageH] = PAPER[paper] || PAPER.a4;
    const scale = Math.min(pageW / size.width, pageH / size.height);
    const drawW = size.width * scale;
    const drawH = size.height * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const pad = n => String(n).padStart(2, '0');
    const stamp = `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

    const parts = [];
    const offsets = [];
    let length = 0;
    const push = chunk => { const data = typeof chunk === 'string' ? asciiBytes(chunk) : chunk; parts.push(data); length += data.length; };
    const object = (number, body) => { offsets[number] = length; push(`${number} 0 obj\n`); body(); push('\nendobj\n'); };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    object(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    object(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
    object(4, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${size.width} /Height ${size.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      push('\nendstream');
    });
    object(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}endstream`));
    object(6, () => push(`<< /Title ${pdfText(title)} /Author ${pdfText(author)} /Creator ${pdfText('Zuglak Studio 2.0')} /CreationDate (${stamp}) >>`));
    const xref = length;
    let table = `xref\n0 7\n0000000000 65535 f \n`;
    for (let number = 1; number <= 6; number += 1) table += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
    push(table);
    push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const output = new Uint8Array(length);
    let cursor = 0;
    for (const part of parts) { output.set(part, cursor); cursor += part.length; }
    return output;
  }

  return Object.freeze({ PAPER, jpegSize, createImagePdf, pdfText });
});
