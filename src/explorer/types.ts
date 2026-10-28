import type { ComponentType } from 'react';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}
export interface EntityRecord {
  key: string;
  data: JsonObject;
}
export interface SchemaField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'array' | 'date' | 'bytes' | 'checksum';
}
export interface EntitySchema {
  fields: SchemaField[];
}
export type FilterOperator =
  'equals' | 'contains' | 'notEquals' | 'greaterThan' | 'lessThan';
export interface SearchFilter {
  field: string;
  operator: FilterOperator;
  value: string | number;
}
export interface SearchQuery {
  text: string;
  filters: SearchFilter[];
  sort: { field: string; direction: 'asc' | 'desc' };
  timeRange: { from: number; to: number } | null;
}
export interface RecordPage {
  items: EntityRecord[];
  total: number;
  nextCursor: string | null;
}
export interface EntityAdapter {
  loadSchema(signal?: AbortSignal): Promise<EntitySchema>;
  search(
    query: SearchQuery,
    cursor?: string | null,
    signal?: AbortSignal
  ): Promise<RecordPage>;
  getRecord(key: string, signal?: AbortSignal): Promise<EntityRecord>;
}
export interface DetailProps {
  recordId: string;
  onClose(): void;
}
export interface EntityDefinition {
  id: string;
  name: string;
  singularName: string;
  description: string;
  routeBase: string;
  detailPaths: string[];
  defaultColumns: string[];
  defaultQuery: SearchQuery;
  searchPlaceholder: string;
  collections: { label: string; filters: SearchFilter[] }[];
  adapter: EntityAdapter;
  Details: ComponentType<DetailProps>;
}
export type AdapterRegistry = Record<string, EntityAdapter>;

export function getValueByPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value
    );
}
