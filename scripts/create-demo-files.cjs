// Explicit fixture maintenance command; never run during server startup or tests.
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const directory = join(__dirname, '../mock/files');
mkdirSync(directory, { recursive: true });
const files = {
  'handbook-v1.txt': Buffer.from(
    '# Recovery handbook\n\nRevision 1\nRestore the most recent verified backup.\nOwner: Platform team\n'
  ),
  'handbook-v2.txt': Buffer.from(
    '# Recovery handbook\n\nRevision 2\n1. Verify the backup checksum.\n2. Restore into an isolated environment.\n3. Validate the restored data.\nOwner: Platform team\n'
  ),
  'handbook-v3.txt': Buffer.from(
    '# Recovery handbook\n\nRevision 3\nVerify, restore, validate, and record the recovery outcome.\n'
  ),
  'configuration.json': Buffer.from(
    '{\n  "name": "Documentation workspace",\n  "retentionDays": 365,\n  "verification": "sha256"\n}\n'
  ),
  'notes.txt': Buffer.from(
    '# Editorial guidelines\n\nKeep documentation concise and reproducible.\nUse stable links to reference a specific version.\n\nRésumé — 日本語 — documentation\n'
  ),
  'empty.txt': Buffer.alloc(0),
  'archive.bin': Buffer.from([0, 255, 1, 13, 10, 0, 128, 42]),
};
const stream =
  'BT /F1 24 Tf 60 740 Td (Document Vault) Tj 0 -40 Td /F1 14 Tf (A preserved documentation snapshot.) Tj 0 -25 Td (Every version has an exact SHA-256 checksum.) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
files['overview.pdf'] = Buffer.from(pdf);
const manifest = {};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(directory, name), bytes);
  manifest[name] = {
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
writeFileSync(
  join(__dirname, '../mock/manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
