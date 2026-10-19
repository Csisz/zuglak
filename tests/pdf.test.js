'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Pdf = require('../pdf.js');

// Minimal valid JPEG header with an SOF0 marker for a 300 × 200 image.
function fakeJpeg(width, height) {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9
  ]);
}

test('JPEG size is read from the SOF marker', () => {
  assert.deepEqual(Pdf.jpegSize(fakeJpeg(300, 200)), { width: 300, height: 200 });
  assert.throws(() => Pdf.jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), /JPEG/);
});

test('image PDF has a correct structure, page size and cross-reference table', () => {
  const bytes = Pdf.createImagePdf({ jpeg: fakeJpeg(3000, 2000), paper: 'a3', title: 'Nappali – Elrendezés B', date: new Date(2026, 9, 16, 12, 0, 0) });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/MediaBox \[0 0 1190\.55 841\.89\]/);
  assert.match(text, /\/Width 3000 \/Height 2000/);
  assert.match(text, /\/CreationDate \(D:20261016120000\)/);
  // Every xref offset must point at "<n> 0 obj".
  const xrefStart = Number(text.match(/startxref\n(\d+)/)[1]);
  const offsets = text.slice(xrefStart).split('\n').slice(3, 9).map(line => Number(line.slice(0, 10)));
  offsets.forEach((offset, index) => assert.equal(text.slice(offset, offset + 7), `${index + 1} 0 obj`));
  // Hungarian title survives as UTF-16BE.
  assert.match(text, new RegExp(Pdf.pdfText('Nappali – Elrendezés B').replace(/[<>]/g, '')));
});
