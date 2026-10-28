import { createSlice } from '@reduxjs/toolkit';
import type { EntityRecord } from '@/explorer/types';
import { loadRecords, searchScope } from './thunks';

interface RecordsState {
  items: EntityRecord[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  scope: string | null;
  requestId: string | null;
  moreRequestId: string | null;
}
const initialState: RecordsState = {
  items: [],
  total: 0,
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  scope: null,
  requestId: null,
  moreRequestId: null,
};
const recordsSlice = createSlice({
  name: 'records',
  initialState,
  reducers: { clearRecords: () => initialState },
  extraReducers: builder =>
    builder
      .addCase(loadRecords.pending, (state, action) => {
        if (action.meta.arg.cursor) {
          if (state.scope !== searchScope(action.meta.arg)) return;
          state.loadingMore = true;
          state.moreRequestId = action.meta.requestId;
        } else {
          Object.assign(state, initialState, {
            scope: searchScope(action.meta.arg),
            requestId: action.meta.requestId,
            loading: true,
          });
        }
        state.error = null;
      })
      .addCase(loadRecords.fulfilled, (state, action) => {
        if (state.scope !== searchScope(action.meta.arg)) return;
        const more = Boolean(action.meta.arg.cursor);
        if (
          (more ? state.moreRequestId : state.requestId) !==
          action.meta.requestId
        )
          return;
        const existing = new Set(state.items.map(item => item.key));
        state.items = more
          ? [
              ...state.items,
              ...action.payload.items.filter(item => !existing.has(item.key)),
            ]
          : action.payload.items;
        state.total = action.payload.total;
        state.nextCursor = action.payload.nextCursor;
        state.loading = false;
        state.loadingMore = false;
        state.error = null;
      })
      .addCase(loadRecords.rejected, (state, action) => {
        if (state.scope !== searchScope(action.meta.arg)) return;
        const more = Boolean(action.meta.arg.cursor);
        if (
          (more ? state.moreRequestId : state.requestId) !==
          action.meta.requestId
        )
          return;
        if (more) state.loadingMore = false;
        else state.loading = false;
        if (!action.meta.aborted)
          state.error = action.error.message || 'Cannot load the collection';
      }),
});
export const { clearRecords } = recordsSlice.actions;
export const recordsReducer = recordsSlice.reducer;
