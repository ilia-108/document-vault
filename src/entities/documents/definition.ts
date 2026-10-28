import type { EntityDefinition } from '@/explorer/types';
import { documentAdapter } from './adapter';
import { DocumentPanel } from './DocumentPanel';

export const documents: EntityDefinition = {
  id: 'documents',
  name: 'Documents',
  singularName: 'Document',
  description: 'Find your documents. Trace every version. Trust the original.',
  routeBase: '/documents',
  detailPaths: [':recordId', ':recordId/versions/:versionId'],
  defaultColumns: [
    'title',
    'latestVersion.versionNumber',
    'latestVersion.capturedAt',
    'latestVersion.file.mediaType',
    'latestVersion.file.sizeBytes',
    'owner',
  ],
  defaultQuery: {
    text: '',
    filters: [],
    sort: { field: 'latestVersion.capturedAt', direction: 'desc' },
    timeRange: null,
  },
  searchPlaceholder: 'Search by title, owner, or filename…',
  collections: [
    { label: 'All documents', filters: [] },
    {
      label: 'PDF documents',
      filters: [
        {
          field: 'latestVersion.file.mediaType',
          operator: 'equals',
          value: 'application/pdf',
        },
      ],
    },
    {
      label: 'Other formats',
      filters: [
        {
          field: 'latestVersion.file.mediaType',
          operator: 'notEquals',
          value: 'application/pdf',
        },
      ],
    },
  ],
  adapter: documentAdapter,
  Details: DocumentPanel,
};
