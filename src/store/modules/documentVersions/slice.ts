import { createSlice } from '@reduxjs/toolkit';
import type {
  DocumentSummary,
  DocumentVersion,
} from '@/entities/documents/types';
import { loadHistory, loadSelection } from './thunks';

interface VersionState {
  document: DocumentSummary | null;
  version: DocumentVersion | null;
  selectionLoading: boolean;
  selectionError: string | null;
  selectionRequestId: string | null;
  history: DocumentVersion[];
  historyDocumentId: string | null;
  historyNextCursor: string | null;
  historyLoading: boolean;
  historyError: string | null;
  historyRequestId: string | null;
}
const initialState: VersionState = {
  document: null,
  version: null,
  selectionLoading: false,
  selectionError: null,
  selectionRequestId: null,
  history: [],
  historyDocumentId: null,
  historyNextCursor: null,
  historyLoading: false,
  historyError: null,
  historyRequestId: null,
};
const slice = createSlice({
  name: 'documentVersions',
  initialState,
  reducers: { clearDocumentVersions: () => initialState },
  extraReducers: builder =>
    builder
      .addCase(loadSelection.pending, (state, action) => {
        state.selectionRequestId = action.meta.requestId;
        state.document = null;
        state.version = null;
        state.selectionLoading = true;
        state.selectionError = null;
      })
      .addCase(loadSelection.fulfilled, (state, action) => {
        if (state.selectionRequestId !== action.meta.requestId) return;
        state.document = action.payload.document;
        state.version = action.payload.version;
        state.selectionLoading = false;
      })
      .addCase(loadSelection.rejected, (state, action) => {
        if (state.selectionRequestId !== action.meta.requestId) return;
        state.selectionLoading = false;
        if (!action.meta.aborted)
          state.selectionError =
            action.error.message || 'Cannot load this version';
      })
      .addCase(loadHistory.pending, (state, action) => {
        state.historyRequestId = action.meta.requestId;
        state.historyLoading = true;
        state.historyError = null;
        if (!action.meta.arg.cursor) {
          state.history = [];
          state.historyNextCursor = null;
          state.historyDocumentId = action.meta.arg.documentId;
        }
      })
      .addCase(loadHistory.fulfilled, (state, action) => {
        if (
          state.historyRequestId !== action.meta.requestId ||
          state.historyDocumentId !== action.meta.arg.documentId
        )
          return;
        const existing = new Set(
          state.history.map(version => version.versionId)
        );
        state.history = action.meta.arg.cursor
          ? [
              ...state.history,
              ...action.payload.items.filter(
                version => !existing.has(version.versionId)
              ),
            ]
          : action.payload.items;
        state.historyNextCursor = action.payload.nextCursor;
        state.historyLoading = false;
      })
      .addCase(loadHistory.rejected, (state, action) => {
        if (state.historyRequestId !== action.meta.requestId) return;
        state.historyLoading = false;
        if (!action.meta.aborted)
          state.historyError =
            action.error.message || 'Cannot load version history';
      }),
});
export const { clearDocumentVersions } = slice.actions;
export const documentVersionsReducer = slice.reducer;
