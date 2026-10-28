export interface DocumentVersion {
  versionId: string;
  documentId: string;
  versionNumber: number;
  versionName?: string;
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
