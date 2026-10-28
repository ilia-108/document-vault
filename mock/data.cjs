const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('./manifest.json');

const fields = [
  ['title', 'Title', 'string'],
  ['owner', 'Owner', 'string'],
  ['tags', 'Tags', 'array'],
  ['versionCount', 'Versions', 'number'],
  ['latestVersion.versionNumber', 'Latest version', 'number'],
  ['latestVersion.versionName', 'Version name', 'string'],
  ['latestVersion.capturedAt', 'Captured at', 'date'],
  ['latestVersion.file.mediaType', 'File type', 'string'],
  ['latestVersion.file.sizeBytes', 'File size', 'bytes'],
  ['latestVersion.checksum.value', 'SHA-256', 'checksum'],
].map(([name, label, type]) => ({ name, label, type }));

function createDataset(scenario = 'initial') {
  const content = new Map();
  for (const [name, expected] of Object.entries(manifest)) {
    const bytes = readFileSync(join(__dirname, 'files', name));
    if (
      bytes.length !== expected.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== expected.sha256
    )
      throw new Error(`Fixture integrity check failed: ${name}`);
    content.set(name, bytes);
  }
  const documents = [];
  const versions = new Map();
  const files = new Map();
  const titles = [
    'Recovery handbook',
    'Workspace overview',
    'Publishing configuration',
    'Editorial guidelines',
    'Architecture decisions',
    'Release checklist',
    'API reference',
    'Accessibility standards',
    'Design principles',
    'Operations manual',
    'Empty template',
    'Preserved binary',
  ];
  for (let index = 0; index < 36; index++) {
    const documentId = `mock_doc_${String(index + 1).padStart(3, '0')}`;
    const title =
      index < titles.length
        ? titles[index]
        : `${['Engineering', 'Product', 'Research'][index % 3]} reference ${index + 1}`;
    const count =
      index === 0
        ? scenario === 'advanced'
          ? 3
          : 2
        : index === 4
          ? 26
          : (index % 4) + 1;
    const entries = [];
    for (let number = 1; number <= count; number++) {
      const fileName =
        index === 0
          ? `handbook-v${number}.txt`
          : index === 1
            ? 'overview.pdf'
            : index === 2
              ? 'configuration.json'
              : index === 10
                ? 'empty.txt'
                : index === 11
                  ? 'archive.bin'
                  : index % 4 === 0
                    ? 'overview.pdf'
                    : index % 4 === 2
                      ? 'configuration.json'
                      : 'notes.txt';
      const mediaType = fileName.endsWith('.pdf')
        ? 'application/pdf'
        : fileName.endsWith('.json')
          ? 'application/json'
          : fileName.endsWith('.txt')
            ? 'text/plain'
            : 'application/octet-stream';
      const versionId = `mock_ver_${String(index + 1).padStart(3, '0')}_${String(number).padStart(3, '0')}`;
      const version = {
        versionId,
        documentId,
        versionNumber: number,
        ...(index === 3
          ? {
              versionName:
                number === 1
                  ? 'Initial draft'
                  : number === 2
                    ? 'Editorial review'
                    : number === 3
                      ? 'Approved for publication'
                      : 'Published edition',
            }
          : {}),
        capturedAt: 1793001600 - index * 86400 + number * 3600,
        capturedBy: ['Alex Morgan', 'Sam Rivera', 'Jordan Lee'][index % 3],
        file: {
          name: index === 3 ? 'Editorial notes — résumé.txt' : fileName,
          mediaType,
          sizeBytes: manifest[fileName].sizeBytes,
        },
        checksum: { algorithm: 'sha256', value: manifest[fileName].sha256 },
        snapshot: {
          title: index === 0 && number === 1 ? 'Restore procedure' : title,
          author: ['Alex Morgan', 'Sam Rivera', 'Jordan Lee'][index % 3],
          tags: [
            ['handbook', 'platform'],
            ['reference', 'workspace'],
            ['configuration', 'engineering'],
          ][index % 3],
          source: 'Documentation workspace',
          sourceRevision: `revision-${number}`,
        },
      };
      entries.push(version);
      files.set(versionId, content.get(fileName));
    }
    entries.reverse();
    versions.set(documentId, entries);
    documents.push({
      documentId,
      title,
      owner: entries[0].snapshot.author,
      tags: entries[0].snapshot.tags,
      createdAt: entries.at(-1).capturedAt,
      latestVersionId: entries[0].versionId,
      versionCount: count,
      latestVersion: entries[0],
    });
  }
  return { documents, versions, files };
}
module.exports = { createDataset, fields };
