const http = require('node:http');
const { createHash } = require('node:crypto');
const { createDataset, fields } = require('./data.cjs');
const { searchDocuments, paginate } = require('./search.cjs');

function createMockServer({ scenario = 'initial' } = {}) {
  const data = createDataset(scenario);
  for (const entries of data.versions.values())
    for (const version of entries)
      version.identicalVersions = entries
        .filter(
          other =>
            other.versionId !== version.versionId &&
            other.checksum.value === version.checksum.value &&
            other.file.sizeBytes === version.file.sizeBytes
        )
        .sort((a, b) => a.versionNumber - b.versionNumber)
        .map(({ versionId, versionNumber, versionName }) => ({
          versionId,
          versionNumber,
          ...(versionName ? { versionName } : {}),
        }));
  for (const doc of data.documents)
    doc.latestVersion = data.versions
      .get(doc.documentId)
      .find(v => v.versionId === doc.latestVersionId);
  return http.createServer(async (request, response) => {
    const json = (status, body) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/health')
        return json(200, {
          status: 'ok',
          application: 'document-vault',
          mode: 'mock',
        });
      if (
        request.method === 'GET' &&
        url.pathname === '/api/v1/documents/schema'
      )
        return json(200, { data: { fields } });
      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/documents/search'
      ) {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 65536)
            throw Object.assign(new Error('Request is too large'), {
              status: 413,
            });
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        } catch {
          throw Object.assign(new Error('Invalid JSON'), { status: 400 });
        }
        const items = searchDocuments(data.documents, body);
        const scope = createHash('sha256')
          .update(
            JSON.stringify({
              text: body.text,
              filters: body.filters,
              sort: body.sort,
              timeRange: body.timeRange,
            })
          )
          .digest('hex');
        return json(200, {
          data: paginate(items, body.limit ?? 20, body.cursor, scope),
        });
      }
      const match = url.pathname.match(
        /^\/api\/v1\/documents\/([^/]+)(?:\/(versions)(?:\/([^/]+)(?:\/(content))?)?)?$/
      );
      if (request.method !== 'GET' || !match)
        return json(404, { error: 'Resource not found' });
      const [, rawId, history, rawVersionId, content] = match;
      const documentId = decodeURIComponent(rawId);
      const document = data.documents.find(
        item => item.documentId === documentId
      );
      if (!document) return json(404, { error: 'Document not found' });
      if (!history) return json(200, { data: document });
      const entries = data.versions.get(documentId);
      if (!rawVersionId)
        return json(200, {
          data: paginate(
            entries,
            Number(url.searchParams.get('limit') || 20),
            url.searchParams.get('cursor'),
            documentId
          ),
        });
      const version = entries.find(
        item => item.versionId === decodeURIComponent(rawVersionId)
      );
      if (!version) return json(404, { error: 'Version not found' });
      if (!content) return json(200, { data: version });
      const bytes = data.files.get(version.versionId);
      response.writeHead(200, {
        'Content-Type': version.file.mediaType,
        'Content-Length': bytes.length,
        'Content-Disposition': `attachment; filename="document${version.file.name.endsWith('.pdf') ? '.pdf' : ''}"; filename*=UTF-8''${encodeURIComponent(version.file.name)}`,
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(bytes);
    } catch (error) {
      json(error.status || 500, {
        error: error.status
          ? error.message
          : 'Cannot read the document library',
      });
    }
  });
}
if (require.main === module) {
  const port = Number(process.env.MOCK_PORT || 3045);
  const server = createMockServer();
  server.on('error', error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`Document Vault mock API: http://127.0.0.1:${port}/api`)
  );
}
module.exports = { createMockServer };
