import { describe, expect, it } from 'vitest';
import {
  decodeQuery,
  decodeSearchLink,
  encodeSearchLink,
  preferenceKey,
  readPreferences,
} from '@/explorer/preferences';
import type { EntityDefinition, SearchQuery } from '@/explorer/types';

const query: SearchQuery = {
  text: '日本語 résumé',
  filters: [{ field: 'title', operator: 'contains', value: 'guide' }],
  sort: { field: 'title', direction: 'asc' },
  timeRange: null,
};
const entity = {
  id: 'documents',
  defaultColumns: ['title'],
  defaultQuery: query,
} as EntityDefinition;
describe('collection search state', () => {
  it('round-trips Unicode and keeps collection identity in links', () => {
    const encoded = encodeSearchLink('documents', query);
    expect(decodeSearchLink(encoded, 'documents', ['title'])).toEqual(query);
    expect(() =>
      decodeSearchLink(encoded, 'another-collection', ['title'])
    ).toThrow('different collection');
  });
  it('validates fields, numeric values and optional time boundaries', () => {
    expect(decodeQuery(query, ['title']).timeRange).toBeNull();
    expect(() => decodeQuery(query, [])).toThrow();
    expect(() =>
      decodeQuery({ ...query, timeRange: { from: 20, to: 10 } }, ['title'])
    ).toThrow();
    expect(() =>
      decodeQuery(
        {
          ...query,
          filters: [{ field: 'title', operator: 'equals', value: {} }],
        },
        ['title']
      )
    ).toThrow();
  });
  it('discards unknown columns, invalid storage and incompatible versions', () => {
    const storage = (value: unknown) => ({
      getItem: () => JSON.stringify(value),
    });
    expect(
      readPreferences(
        entity,
        ['title'],
        storage({ version: 1, columns: ['missing', 'title', 'title'], query })
      ).columns
    ).toEqual(['title']);
    expect(
      readPreferences(entity, ['title'], storage({ version: 2 })).columns
    ).toEqual(['title']);
    expect(
      readPreferences(entity, ['title'], { getItem: () => '{invalid' }).query
    ).toEqual(query);
    expect(
      readPreferences(entity, ['title'], {
        getItem: () => {
          throw new Error();
        },
      }).query
    ).toEqual(query);
    expect(preferenceKey('documents')).not.toBe(preferenceKey('other'));
  });
});
