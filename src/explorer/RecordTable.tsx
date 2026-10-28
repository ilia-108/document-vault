import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from '@/components/Icon';
import { formatBytes, formatDate } from '@/components/format';
import { getValueByPath } from './types';
import type {
  EntityDefinition,
  EntityRecord,
  EntitySchema,
  SchemaField,
  SearchQuery,
} from './types';

function cellValue(field: SchemaField, value: unknown) {
  if (value === null || value === undefined) return '—';
  if (field.type === 'date' && typeof value === 'number')
    return formatDate(value);
  if (field.type === 'bytes' && typeof value === 'number')
    return formatBytes(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function RecordTable({
  entity,
  schema,
  columns,
  records,
  loading,
  onOpen,
  query,
  onSort,
}: {
  entity: EntityDefinition;
  schema: EntitySchema;
  columns: string[];
  records: EntityRecord[];
  loading: boolean;
  onOpen(key: string): void;
  query: SearchQuery;
  onSort(sort: SearchQuery['sort']): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const fields = columns.flatMap(name => {
    const field = schema.fields.find(field => field.name === name);
    return field ? [field] : [];
  });
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 68,
    overscan: 6,
    getItemKey: index => records[index].key,
  });
  const template = fields
    .map((_, index) =>
      index === 0 ? 'minmax(250px, 2.2fr)' : 'minmax(130px, 1fr)'
    )
    .join(' ');
  if (!loading && !records.length)
    return (
      <div className='empty-state'>
        <span className='empty-icon'>
          <Icon name='search' size={30} />
        </span>
        <h3>No {entity.name.toLowerCase()} found</h3>
        <p>Try another search or remove a filter.</p>
      </div>
    );
  return (
    <div
      className='table-viewport'
      ref={viewport}
      tabIndex={0}
      role='region'
      aria-label={`${entity.name} table`}
    >
      <table
        className='record-table'
        style={{ minWidth: Math.max(700, fields.length * 145 + 140) }}
        aria-label={entity.name}
        aria-busy={loading}
      >
        <thead>
          <tr style={{ gridTemplateColumns: template }}>
            {fields.map(field => (
              <th
                key={field.name}
                scope='col'
                aria-sort={
                  query.sort.field === field.name
                    ? query.sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  onClick={() =>
                    onSort({
                      field: field.name,
                      direction:
                        query.sort.field === field.name &&
                        query.sort.direction === 'asc'
                          ? 'desc'
                          : 'asc',
                    })
                  }
                >
                  {field.label}
                  <span aria-hidden='true'>
                    {query.sort.field === field.name
                      ? query.sort.direction === 'asc'
                        ? '↑'
                        : '↓'
                      : '↕'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ height: loading ? 340 : virtualizer.getTotalSize() }}>
          {loading
            ? Array.from({ length: 5 }, (_, index) => (
                <tr
                  className='skeleton-row'
                  key={index}
                  style={{
                    transform: `translateY(${index * 68}px)`,
                    gridTemplateColumns: template,
                  }}
                >
                  {fields.map(field => (
                    <td key={field.name}>
                      <span className='skeleton' />
                    </td>
                  ))}
                </tr>
              ))
            : virtualizer.getVirtualItems().map(item => {
                const record = records[item.index];
                return (
                  <tr
                    key={record.key}
                    style={{
                      transform: `translateY(${item.start}px)`,
                      gridTemplateColumns: template,
                    }}
                  >
                    {fields.map((field, index) => (
                      <td
                        key={field.name}
                        title={cellValue(
                          field,
                          getValueByPath(record.data, field.name)
                        )}
                      >
                        {index === 0 ? (
                          <button
                            className='record-title'
                            onClick={() => onOpen(record.key)}
                          >
                            <span className='file-icon'>
                              <Icon name='document' size={19} />
                            </span>
                            <span>
                              {cellValue(
                                field,
                                getValueByPath(record.data, field.name)
                              )}
                              <span className='record-subtitle'>
                                Open {entity.singularName.toLowerCase()} details
                              </span>
                            </span>
                          </button>
                        ) : field.type === 'checksum' ? (
                          <code className='checksum-cell'>
                            {cellValue(
                              field,
                              getValueByPath(record.data, field.name)
                            )}
                          </code>
                        ) : (
                          <span
                            className={
                              field.type === 'number' ? 'version-badge' : ''
                            }
                          >
                            {cellValue(
                              field,
                              getValueByPath(record.data, field.name)
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
