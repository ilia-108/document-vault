import { createAsyncThunk } from '@reduxjs/toolkit';
import type {
  AdapterRegistry,
  RecordPage,
  SearchQuery,
} from '@/explorer/types';
import { getEntityAdapter } from './api';

export interface SearchArgs {
  entityId: string;
  query: SearchQuery;
  cursor?: string | null;
}
export const searchScope = (args: SearchArgs) =>
  JSON.stringify([args.entityId, args.query]);
export const loadRecords = createAsyncThunk<
  RecordPage,
  SearchArgs,
  { extra: AdapterRegistry }
>('records/search', (args, { extra, signal }) =>
  getEntityAdapter(args.entityId, extra).search(args.query, args.cursor, signal)
);
