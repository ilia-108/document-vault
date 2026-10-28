import { requestBlob, requestJson } from '@/services/api';
import { parseDocument, parseVersion, parseVersionPage } from './validation';

const path = (id: string) => `v1/documents/${encodeURIComponent(id)}`;
export const getDocument = async (id: string, signal?: AbortSignal) => {
  const document = await requestJson(path(id), parseDocument, { signal });
  if (document.documentId !== id)
    throw new Error('Document identity does not match the requested record');
  return document;
};
export const getVersion = async (
  documentId: string,
  versionId: string,
  signal?: AbortSignal
) => {
  const version = await requestJson(
    `${path(documentId)}/versions/${encodeURIComponent(versionId)}`,
    parseVersion,
    { signal }
  );
  if (version.documentId !== documentId || version.versionId !== versionId)
    throw new Error('Version identity does not match the requested snapshot');
  return version;
};
export const getVersions = async (
  documentId: string,
  cursor?: string | null,
  signal?: AbortSignal
) => {
  const query = new URLSearchParams({
    limit: '20',
    ...(cursor ? { cursor } : {}),
  });
  const page = await requestJson(
    `${path(documentId)}/versions?${query}`,
    parseVersionPage,
    { signal }
  );
  if (page.items.some(version => version.documentId !== documentId))
    throw new Error('Version history belongs to another document');
  return page;
};
export const getVersionContent = (
  documentId: string,
  versionId: string,
  signal?: AbortSignal
) =>
  requestBlob(
    `${path(documentId)}/versions/${encodeURIComponent(versionId)}/content`,
    signal
  );
