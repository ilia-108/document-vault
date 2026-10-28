const { fields } = require('./data.cjs');
const getValue = (record, path) =>
  path.split('.').reduce((value, part) => value?.[part], record);
const badRequest = message =>
  Object.assign(new Error(message), { status: 400 });
const allowedFields = new Set(fields.map(field => field.name));
const operators = new Set([
  'equals',
  'contains',
  'notEquals',
  'greaterThan',
  'lessThan',
]);

function searchDocuments(documents, body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw badRequest('Invalid search request');
  const {
    text = '',
    filters = [],
    sort = { field: 'latestVersion.capturedAt', direction: 'desc' },
    timeRange = null,
  } = body;
  if (
    typeof text !== 'string' ||
    !Array.isArray(filters) ||
    !sort ||
    !allowedFields.has(sort.field) ||
    !['asc', 'desc'].includes(sort.direction)
  )
    throw badRequest('Invalid search query');
  for (const filter of filters) {
    if (
      !filter ||
      !allowedFields.has(filter.field) ||
      !operators.has(filter.operator) ||
      !['string', 'number'].includes(typeof filter.value)
    )
      throw badRequest('Invalid filter');
    const field = fields.find(item => item.name === filter.field);
    if (
      ['greaterThan', 'lessThan'].includes(filter.operator) &&
      (!['number', 'date', 'bytes'].includes(field.type) ||
        !Number.isFinite(Number(filter.value)))
    )
      throw badRequest('Invalid numeric comparison');
  }
  if (
    timeRange &&
    (typeof timeRange !== 'object' ||
      !Number.isFinite(timeRange.from) ||
      !Number.isFinite(timeRange.to) ||
      timeRange.from > timeRange.to)
  )
    throw badRequest('Invalid date range');
  const normalized = text.trim().toLowerCase();
  let items = documents.filter(document => {
    const matchesText =
      !normalized ||
      [document.title, document.owner, document.latestVersion.file.name].some(
        value => value.toLowerCase().includes(normalized)
      );
    return (
      matchesText &&
      filters.every(filter => {
        const actual = getValue(document, filter.field);
        const value = Array.isArray(actual)
          ? actual.join(', ')
          : String(actual ?? '');
        if (filter.operator === 'equals') return value === String(filter.value);
        if (filter.operator === 'notEquals')
          return value !== String(filter.value);
        if (filter.operator === 'contains')
          return value
            .toLowerCase()
            .includes(String(filter.value).toLowerCase());
        if (filter.operator === 'greaterThan')
          return Number(actual) > Number(filter.value);
        return Number(actual) < Number(filter.value);
      }) &&
      (!timeRange ||
        (document.latestVersion.capturedAt >= timeRange.from &&
          document.latestVersion.capturedAt <= timeRange.to))
    );
  });
  items = [...items].sort((left, right) => {
    const a = getValue(left, sort.field),
      b = getValue(right, sort.field);
    const comparison =
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b));
    return (
      (sort.direction === 'asc' ? comparison : -comparison) ||
      left.documentId.localeCompare(right.documentId)
    );
  });
  return items;
}

function paginate(items, limit = 20, cursor, scope = '') {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw badRequest('Limit must be an integer between 1 and 100');
  let offset = 0;
  if (cursor !== undefined && cursor !== null) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (
        !Number.isInteger(decoded.offset) ||
        decoded.offset < 0 ||
        decoded.scope !== scope
      )
        throw new Error();
      offset = decoded.offset;
    } catch {
      throw badRequest('Invalid cursor');
    }
  }
  const nextOffset = offset + limit;
  return {
    items: items.slice(offset, nextOffset),
    total: items.length,
    nextCursor:
      nextOffset < items.length
        ? Buffer.from(JSON.stringify({ offset: nextOffset, scope })).toString(
            'base64url'
          )
        : null,
  };
}
module.exports = { searchDocuments, paginate };
