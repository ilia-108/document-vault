import type { EntityAdapter, EntityRecord, JsonObject } from '@/explorer/types';
import { requestJson } from '@/services/api';
import { getDocument } from './api';
import { object, parseDocument, parseSchema } from './validation';
import type { DocumentSummary } from './types';

const toRecord = (document: DocumentSummary): EntityRecord => ({
  key: document.documentId,
  data: document as unknown as JsonObject,
});
export const documentAdapter: EntityAdapter = {
  loadSchema: signal =>
    requestJson('v1/documents/schema', parseSchema, { signal }),
  search: (query, cursor, signal) =>
    requestJson(
      'v1/documents/search',
      value => {
        const page = object(value);
        if (
          !Array.isArray(page.items) ||
          !Number.isSafeInteger(page.total) ||
          Number(page.total) < 0 ||
          !(page.nextCursor === null || typeof page.nextCursor === 'string')
        )
          throw new Error('Invalid collection response');
        return {
          items: page.items.map(parseDocument).map(toRecord),
          total: Number(page.total),
          nextCursor: page.nextCursor,
        };
      },
      { body: { ...query, limit: 20, ...(cursor ? { cursor } : {}) }, signal }
    ),
  getRecord: async (key, signal) => toRecord(await getDocument(key, signal)),
};
