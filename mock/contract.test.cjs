const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createMockServer } = require('./server.cjs');
const { createDataset } = require('./data.cjs');
let server, base;
before(async () => {
  server = createMockServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/documents`;
});
after(() => new Promise(resolve => server.close(resolve)));
const json = async path => (await (await fetch(`${base}${path}`)).json()).data;
const search = async body => {
  const response = await fetch(`${base}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

test('search and cursor pagination use one stable filtered collection', async () => {
  const first = await search({ limit: 20 });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.total, 36);
  assert.equal(first.body.data.items.length, 20);
  const second = await search({
    limit: 20,
    cursor: first.body.data.nextCursor,
  });
  assert.equal(second.body.data.items.length, 16);
  assert.equal(second.body.data.nextCursor, null);
  assert.equal(
    new Set(
      [...first.body.data.items, ...second.body.data.items].map(
        item => item.documentId
      )
    ).size,
    36
  );
  const filtered = await search({ text: 'recovery' });
  assert.equal(filtered.body.data.total, 1);
  assert.equal(filtered.body.data.items[0].documentId, 'mock_doc_001');
  const badCursor = await search({
    text: 'different query',
    cursor: first.body.data.nextCursor,
  });
  assert.equal(badCursor.status, 400);
});
test('schema and exact checksum filters agree with document data', async () => {
  const schema = await json('/schema');
  assert.ok(
    schema.fields.find(field => field.name === 'latestVersion.checksum.value')
  );
  const document = await json('/mock_doc_001');
  const result = await search({
    filters: [
      {
        field: 'latestVersion.checksum.value',
        operator: 'equals',
        value: document.latestVersion.checksum.value,
      },
    ],
  });
  assert.equal(result.body.data.total, 1);
});
test('every served version matches its recorded size and checksum', async () => {
  const data = createDataset();
  for (const entries of data.versions.values()) {
    for (const version of entries) {
      const response = await fetch(
        `${base}/${version.documentId}/versions/${version.versionId}/content`
      );
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, version.file.sizeBytes);
      assert.equal(
        response.headers.get('content-length'),
        String(bytes.length)
      );
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        version.checksum.value
      );
      assert.equal(
        response.headers.get('content-type'),
        version.file.mediaType
      );
    }
  }
});
test('a new latest version preserves old metadata and exact content', () => {
  const before = createDataset(),
    after = createDataset('advanced');
  assert.notEqual(
    before.documents[0].latestVersionId,
    after.documents[0].latestVersionId
  );
  for (const old of before.versions.get('mock_doc_001')) {
    const preserved = after.versions
      .get('mock_doc_001')
      .find(item => item.versionId === old.versionId);
    assert.deepEqual(preserved, old);
    assert.deepEqual(
      after.files.get(old.versionId),
      before.files.get(old.versionId)
    );
  }
  assert.notEqual(
    before.documents[0].title,
    before.versions.get('mock_doc_001').at(-1).snapshot.title
  );
});
test('equal content checksums do not collapse distinct versions', async () => {
  const history = await json('/mock_doc_005/versions?limit=20');
  assert.equal(history.items.length, 20);
  assert.equal(new Set(history.items.map(item => item.versionId)).size, 20);
  assert.equal(new Set(history.items.map(item => item.checksum.value)).size, 1);
  const second = await json(
    `/mock_doc_005/versions?limit=20&cursor=${encodeURIComponent(history.nextCursor)}`
  );
  assert.equal(second.items.length, 6);
  assert.equal(second.nextCursor, null);
});
test('unknown documents and foreign versions return 404 without fallback', async () => {
  for (const path of [
    '/missing',
    '/mock_doc_001/versions/missing',
    '/mock_doc_002/versions/mock_ver_001_001',
    '/mock_doc_002/versions/mock_ver_001_001/content',
  ])
    assert.equal((await fetch(`${base}${path}`)).status, 404);
});
test('invalid filters, ranges, limits and JSON return 400', async () => {
  for (const body of [
    { filters: [{ field: 'missing', operator: 'equals', value: 'x' }] },
    { filters: [{ field: 'title', operator: 'execute', value: 'x' }] },
    { limit: 0 },
    { limit: 1.5 },
    { cursor: 'broken' },
    { timeRange: { from: 10, to: 1 } },
    { filters: [{ field: 'title', operator: 'greaterThan', value: 'x' }] },
  ])
    assert.equal((await search(body)).status, 400);
  assert.equal(
    (await fetch(`${base}/search`, { method: 'POST', body: '{broken' })).status,
    400
  );
});
