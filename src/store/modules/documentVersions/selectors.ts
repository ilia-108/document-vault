import type { RootState } from '@/store/store';
export const selectDocumentVersions = (state: RootState) =>
  state.documentVersions;
