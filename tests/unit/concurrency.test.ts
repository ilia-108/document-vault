import { describe, expect, it } from 'vitest';
import { recordsReducer } from '@/store/modules/records/slice';
import { loadRecords } from '@/store/modules/records/thunks';
import { documentVersionsReducer } from '@/store/modules/documentVersions/slice';
import { loadSelection } from '@/store/modules/documentVersions/thunks';
import type { SearchQuery } from '@/explorer/types';
import type {
  DocumentSummary,
  DocumentVersion,
} from '@/entities/documents/types';

const query: SearchQuery = {
  text: '',
  filters: [],
  sort: { field: 'title', direction: 'asc' },
  timeRange: null,
};
const first = { entityId: 'documents', query };
const second = { entityId: 'documents', query: { ...query, text: 'new' } };
const page = {
  items: [{ key: 'old', data: { title: 'Old' } }],
  total: 1,
  nextCursor: null,
};
describe('request identity', () => {
  it('ignores an older search even when it finishes later', () => {
    let state = recordsReducer(undefined, loadRecords.pending('a', first));
    state = recordsReducer(state, loadRecords.pending('b', second));
    state = recordsReducer(state, loadRecords.fulfilled(page, 'a', first));
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(true);
    state = recordsReducer(
      state,
      loadRecords.fulfilled(
        { ...page, items: [{ key: 'new', data: { title: 'New' } }] },
        'b',
        second
      )
    );
    expect(state.items[0].key).toBe('new');
  });
  it('ignores an old next page after a new search starts', () => {
    let state = recordsReducer(undefined, loadRecords.pending('a', first));
    state = recordsReducer(state, loadRecords.fulfilled(page, 'a', first));
    const more = { ...first, cursor: 'old-page' };
    state = recordsReducer(state, loadRecords.pending('more', more));
    state = recordsReducer(state, loadRecords.pending('b', second));
    state = recordsReducer(state, loadRecords.fulfilled(page, 'more', more));
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(true);
  });
  it('ignores late version selection responses', () => {
    const old = { documentId: 'document', versionId: 'v1' };
    const latest = { documentId: 'document', versionId: 'v2' };
    let state = documentVersionsReducer(
      undefined,
      loadSelection.pending('old', old)
    );
    state = documentVersionsReducer(
      state,
      loadSelection.pending('new', latest)
    );
    state = documentVersionsReducer(
      state,
      loadSelection.fulfilled(
        {
          document: { documentId: 'document' } as DocumentSummary,
          version: { versionId: 'v1' } as DocumentVersion,
        },
        'old',
        old
      )
    );
    expect(state.version).toBeNull();
    expect(state.selectionLoading).toBe(true);
  });
});
