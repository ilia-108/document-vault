export interface VersionReference {
  versionId: string;
  versionNumber: number;
  versionName?: string;
}
export interface DocumentVersion {
  identicalVersions?: VersionReference[];
  versionId: string;
  documentId: string;
  versionNumber: number;
  versionName?: string;
  encryption?: { enabled: boolean; algorithm?: string; provider?: string };
  capturedAt: number;
  capturedBy: string;
  file: { name: string; mediaType: string; sizeBytes: number };
  checksum: { algorithm: 'sha256'; value: string };
  snapshot: {
    title: string;
    author: string;
    tags: string[];
    source: string;
    sourceRevision?: string;
  };
}
export interface DocumentSummary {
  documentId: string;
  encryptionRequired?: boolean;
  title: string;
  owner: string;
  tags: string[];
  createdAt: number;
  latestVersionId: string;
  versionCount: number;
  latestVersion: DocumentVersion;
}
export interface VersionPage {
  items: DocumentVersion[];
  nextCursor: string | null;
}
