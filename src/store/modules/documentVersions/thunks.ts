import { createAsyncThunk } from '@reduxjs/toolkit';
import { getDocument, getVersion, getVersions } from './api';

export const loadSelection = createAsyncThunk(
  'documentVersions/selection',
  async (
    { documentId, versionId }: { documentId: string; versionId?: string },
    { signal }
  ) => {
    const document = await getDocument(documentId, signal);
    const version = await getVersion(
      documentId,
      versionId || document.latestVersionId,
      signal
    );
    return { document, version };
  }
);
export const loadHistory = createAsyncThunk(
  'documentVersions/history',
  (
    { documentId, cursor }: { documentId: string; cursor?: string | null },
    { signal }
  ) => getVersions(documentId, cursor, signal)
);
