import type { EntitySchema, SchemaField } from '@/explorer/types';
import type { DocumentSummary, DocumentVersion, VersionPage } from './types';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid document API response');
  return value as Record<string, unknown>;
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');
export function parseVersion(value: unknown): DocumentVersion {
  const version = object(value),
    file = object(version.file),
    checksum = object(version.checksum),
    snapshot = object(version.snapshot);
  if (
    !['versionId', 'documentId', 'capturedBy'].every(
      key => typeof version[key] === 'string' && version[key]
    ) ||
    !Number.isSafeInteger(version.versionNumber) ||
    Number(version.versionNumber) < 1 ||
    (version.versionName !== undefined &&
      (typeof version.versionName !== 'string' ||
        !version.versionName.trim() ||
        version.versionName.length > 200)) ||
    (version.encryption !== undefined &&
      (typeof object(version.encryption).enabled !== 'boolean' ||
        (object(version.encryption).enabled === true &&
          (object(version.encryption).algorithm !== 'AES-256-GCM' ||
            object(version.encryption).provider !== 'openbao-transit')))) ||
    !Number.isFinite(version.capturedAt) ||
    typeof file.name !== 'string' ||
    typeof file.mediaType !== 'string' ||
    !Number.isSafeInteger(file.sizeBytes) ||
    Number(file.sizeBytes) < 0 ||
    checksum.algorithm !== 'sha256' ||
    typeof checksum.value !== 'string' ||
    !/^[a-f0-9]{64}$/.test(checksum.value) ||
    !['title', 'author', 'source'].every(
      key => typeof snapshot[key] === 'string'
    ) ||
    !strings(snapshot.tags) ||
    (snapshot.sourceRevision !== undefined &&
      typeof snapshot.sourceRevision !== 'string')
  )
    throw new Error('Invalid immutable version metadata');
  if (
    version.identicalVersions !== undefined &&
    (!Array.isArray(version.identicalVersions) ||
      version.identicalVersions.some(item => {
        const ref = object(item);
        return (
          typeof ref.versionId !== 'string' ||
          !ref.versionId ||
          ref.versionId === version.versionId ||
          !Number.isSafeInteger(ref.versionNumber) ||
          Number(ref.versionNumber) < 1 ||
          (ref.versionName !== undefined && typeof ref.versionName !== 'string')
        );
      }))
  )
    throw new Error('Invalid identical version references');
  return value as DocumentVersion;
}
export function parseDocument(value: unknown): DocumentSummary {
  const document = object(value);
  const latest = parseVersion(document.latestVersion);
  if (
    !['documentId', 'title', 'owner', 'latestVersionId'].every(
      key => typeof document[key] === 'string'
    ) ||
    (document.encryptionRequired !== undefined &&
      typeof document.encryptionRequired !== 'boolean') ||
    !strings(document.tags) ||
    !Number.isSafeInteger(document.versionCount) ||
    Number(document.versionCount) < 1 ||
    !Number.isFinite(document.createdAt) ||
    latest.documentId !== document.documentId ||
    latest.versionId !== document.latestVersionId
  )
    throw new Error('Invalid document metadata');
  return value as DocumentSummary;
}
export function parseVersionPage(value: unknown): VersionPage {
  const page = object(value);
  if (
    !Array.isArray(page.items) ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string')
  )
    throw new Error('Invalid version history');
  return { items: page.items.map(parseVersion), nextCursor: page.nextCursor };
}
export function parseSchema(value: unknown): EntitySchema {
  const schema = object(value);
  if (!Array.isArray(schema.fields))
    throw new Error('Invalid collection schema');
  const fields = schema.fields.map(value => {
    const field = object(value);
    if (
      typeof field.name !== 'string' ||
      typeof field.label !== 'string' ||
      !['string', 'number', 'array', 'date', 'bytes', 'checksum'].includes(
        String(field.type)
      )
    )
      throw new Error('Invalid schema field');
    return field as unknown as SchemaField;
  });
  return { fields };
}
