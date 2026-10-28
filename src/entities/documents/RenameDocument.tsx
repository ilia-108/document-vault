import { useState } from 'react';
import { DetailShell } from '@/explorer/ExplorerLayout';
import type { EntityRecord } from '@/explorer/types';
import { requestJson, errorMessage } from '@/services/api';
import { parseDocument } from './validation';
import type { DocumentSummary } from './types';

export function DocumentRowActions({
  record,
  onChanged,
}: {
  record: EntityRecord;
  onChanged(): void;
}) {
  return (
    <RenameDocument
      document={parseDocument(record.data)}
      onChanged={onChanged}
    />
  );
}
export function RenameDocument({
  document,
  onChanged,
}: {
  document: DocumentSummary;
  onChanged(): void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (window.runtimeConfig?.MODE !== 'server') return null;
  return (
    <>
      <button
        className='text-button rename-button'
        aria-label={`Rename ${document.title}`}
        onClick={() => {
          setTitle(document.title);
          setError('');
          setOpen(true);
        }}
      >
        Rename
      </button>
      {open && (
        <DetailShell
          title='Rename document'
          onClose={busy ? () => {} : () => setOpen(false)}
        >
          <form
            className='filter-dialog'
            onSubmit={async event => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                await requestJson(
                  `v1/documents/${encodeURIComponent(document.documentId)}`,
                  parseDocument,
                  { method: 'PATCH', body: { title: title.trim() } }
                );
                setOpen(false);
                onChanged();
              } catch (error) {
                setError(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Rename document</h2>
            <label>
              Document title
              <input
                autoFocus
                required
                maxLength={300}
                value={title}
                disabled={busy}
                onChange={event => setTitle(event.target.value)}
              />
            </label>
            <p className='subtle'>
              Original filenames and captured version titles are preserved.
            </p>
            {error && (
              <p role='alert' className='error-text'>
                {error}
              </p>
            )}
            <button className='button primary' disabled={busy || !title.trim()}>
              {busy ? 'Saving…' : 'Save title'}
            </button>
          </form>
        </DetailShell>
      )}
    </>
  );
}
