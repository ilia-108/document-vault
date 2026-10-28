import type { EntityDefinition, SearchQuery } from './types';

export interface ExplorerPreferences {
  version: 1;
  columns: string[];
  query: SearchQuery;
}
const operators = [
  'equals',
  'contains',
  'notEquals',
  'greaterThan',
  'lessThan',
];
export function decodeQuery(
  value: unknown,
  allowedFields: string[]
): SearchQuery {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid search state');
  const query = value as SearchQuery;
  if (
    typeof query.text !== 'string' ||
    query.text.length > 2000 ||
    !Array.isArray(query.filters) ||
    query.filters.length > 50 ||
    !query.sort ||
    !allowedFields.includes(query.sort.field) ||
    !['asc', 'desc'].includes(query.sort.direction)
  )
    throw new Error('Invalid search state');
  if (
    !query.filters.every(
      filter =>
        filter &&
        allowedFields.includes(filter.field) &&
        operators.includes(filter.operator) &&
        (typeof filter.value === 'string' ||
          (typeof filter.value === 'number' && Number.isFinite(filter.value)))
    )
  )
    throw new Error('Invalid search filter');
  if (
    query.timeRange !== null &&
    (!query.timeRange ||
      !Number.isFinite(query.timeRange.from) ||
      !Number.isFinite(query.timeRange.to) ||
      query.timeRange.from > query.timeRange.to)
  )
    throw new Error('Invalid date range');
  return {
    text: query.text,
    filters: query.filters,
    sort: query.sort,
    timeRange: query.timeRange,
  };
}
export function preferenceKey(entityId: string) {
  return `document-vault:explorer:${entityId}:v1`;
}
export function readPreferences(
  entity: EntityDefinition,
  fields: string[],
  storage: Pick<Storage, 'getItem'>
): ExplorerPreferences {
  const defaults: ExplorerPreferences = {
    version: 1,
    columns: entity.defaultColumns.filter(name => fields.includes(name)),
    query: entity.defaultQuery,
  };
  try {
    const value = JSON.parse(
      storage.getItem(preferenceKey(entity.id)) || 'null'
    );
    if (value?.version !== 1) return defaults;
    const columns = Array.isArray(value.columns)
      ? [
          ...new Set<string>(
            value.columns.filter(
              (name: unknown): name is string =>
                typeof name === 'string' && fields.includes(name)
            )
          ),
        ]
      : defaults.columns;
    return {
      version: 1,
      columns: columns.length ? columns : defaults.columns,
      query: decodeQuery(value.query, fields),
    };
  } catch {
    return defaults;
  }
}
export function encodeSearchLink(entityId: string, query: SearchQuery): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: 1, entityId, query })
  );
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
export function decodeSearchLink(
  encoded: string,
  entityId: string,
  fields: string[]
): SearchQuery {
  if (encoded.length > 20000) throw new Error('Search link is too large');
  const standard = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(standard), char => char.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (payload?.version !== 1 || payload.entityId !== entityId)
    throw new Error('This search link belongs to a different collection');
  return decodeQuery(payload.query, fields);
}
