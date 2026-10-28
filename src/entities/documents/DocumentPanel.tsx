import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectDocumentVersions } from '@/store/modules/documentVersions/selectors';
import {
  loadHistory,
  loadSelection,
} from '@/store/modules/documentVersions/thunks';
import { Icon } from '@/components/Icon';
import {
  fileType,
  formatBytes,
  formatDate,
  formatDateTime,
} from '@/components/format';
import { errorMessage } from '@/services/api';
import type { DetailProps } from '@/explorer/types';
import { getVersionContent } from './api';
import { verifyBytes } from './checksum';
import type { DocumentVersion } from './types';
import { RenameDocument } from './RenameDocument';
import { IdenticalVersions } from './IdenticalVersions';
import { UploadVersionButton } from './DocumentActions';

export function DocumentPanel({ recordId, onChanged }: DetailProps) {
  const { versionId } = useParams();
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectDocumentVersions);
  const navigate = useNavigate();
  const location = useLocation();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const task = dispatch(loadSelection({ documentId: recordId, versionId }));
    return () => task.abort();
  }, [dispatch, recordId, versionId, retry]);
  useEffect(() => {
    const task = dispatch(loadHistory({ documentId: recordId }));
    return () => task.abort();
  }, [dispatch, recordId, retry]);
  useEffect(() => {
    if (!versionId && state.version?.documentId === recordId)
      navigate(
        {
          pathname: `/documents/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(state.version.versionId)}`,
          search: location.search,
        },
        { replace: true }
      );
  }, [versionId, state.version, recordId, navigate, location.search]);
  const version =
    state.version?.documentId === recordId &&
    (!versionId || state.version.versionId === versionId)
      ? state.version
      : null;
  return (
    <div className='document-panel'>
      <div className='panel-eyebrow'>
        <Icon name='document' size={15} />
        DOCUMENT DETAILS
      </div>
      {state.selectionError ? (
        <div className='panel-error' role='alert'>
          <Icon name='document' size={32} />
          <h2>
            {state.selectionError.includes('not found')
              ? 'Snapshot not found'
              : 'Cannot open this snapshot'}
          </h2>
          <p>{state.selectionError}</p>
          <button
            className='button'
            onClick={() => setRetry(value => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : !version || state.selectionLoading ? (
        <div className='panel-loading' role='status'>
          Loading preserved version…
        </div>
      ) : (
        <>
          <div className='document-heading'>
            <div
              className={`file-type-icon ${fileType(version.file.mediaType).toLowerCase()}`}
            >
              <Icon name='document' size={28} />
              <span>{fileType(version.file.mediaType)}</span>
            </div>
            <div>
              <h2>{version.snapshot.title}</h2>
              <p>{version.file.name}</p>
            </div>
          </div>
          <div className='snapshot-label'>
            <Icon name='clock' size={15} />
            <strong>
              Version {version.versionNumber}
              {version.versionName && ` — ${version.versionName}`}
            </strong>
            <span>Captured {formatDate(version.capturedAt)}</span>
            {state.document?.latestVersionId === version.versionId ? (
              <span className='latest-badge'>LATEST</span>
            ) : (
              <span className='historic-badge'>PRESERVED</span>
            )}
          </div>
          <IdenticalVersions version={version} />
          {state.document &&
            state.document.title !== version.snapshot.title && (
              <p className='rename-note'>
                Current document title: {state.document.title}
              </p>
            )}
          {version.encryption && (
            <p className='encryption-state'>
              <Icon name='shield' size={14} />
              {version.encryption.enabled
                ? 'Encrypted at rest · AES-256-GCM · OpenBao'
                : 'Stored without file encryption'}
              {state.document?.encryptionRequired && !version.encryption.enabled
                ? ' · Newer versions require encryption'
                : ''}
            </p>
          )}
          <VersionContents key={version.versionId} version={version} />
        </>
      )}
      {state.document && (
        <div className='version-upload'>
          <RenameDocument
            document={state.document}
            onChanged={() => {
              onChanged();
              setRetry(value => value + 1);
            }}
          />
          <UploadVersionButton
            document={state.document}
            onCreated={created => {
              onChanged();
              void dispatch(loadHistory({ documentId: recordId }));
              navigate(`/documents/${recordId}/versions/${created.versionId}`);
            }}
          />
        </div>
      )}
      <section className='history-section'>
        <div className='section-heading'>
          <h3>Version history</h3>
          <span className='subtle'>Preserved snapshots</span>
        </div>
        {state.historyDocumentId === recordId &&
          state.history.map(item => (
            <div key={item.versionId} className='history-entry'>
              <button
                className={`history-item ${item.versionId === versionId ? 'selected' : ''}`}
                key={item.versionId}
                aria-current={item.versionId === versionId ? 'true' : undefined}
                onClick={() =>
                  navigate({
                    pathname: `/documents/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(item.versionId)}`,
                    search: location.search,
                  })
                }
              >
                <span className='history-dot' />
                <div>
                  <strong>
                    Version {item.versionNumber}
                    {item.versionName && ` — ${item.versionName}`}
                    {item.versionId === state.document?.latestVersionId && (
                      <span className='latest-badge'>LATEST</span>
                    )}
                  </strong>
                  <span>
                    {formatDateTime(item.capturedAt)} · {item.capturedBy}
                  </span>
                  <code>{item.checksum.value.slice(0, 16)}…</code>
                </div>
                <span className='history-size'>
                  {formatBytes(item.file.sizeBytes)}
                </span>
                <Icon name='chevron' size={14} />
              </button>
              <IdenticalVersions version={item} />
            </div>
          ))}
        {state.historyLoading && (
          <p className='subtle' role='status'>
            Loading version history…
          </p>
        )}
        {state.historyError && (
          <div className='error-banner' role='alert'>
            {state.historyError}
            <button
              className='text-button'
              onClick={() =>
                dispatch(
                  loadHistory({
                    documentId: recordId,
                    cursor: state.historyNextCursor,
                  })
                )
              }
            >
              Retry history
            </button>
          </div>
        )}
        {state.historyNextCursor && (
          <button
            className='button full-width'
            disabled={state.historyLoading}
            onClick={() =>
              dispatch(
                loadHistory({
                  documentId: recordId,
                  cursor: state.historyNextCursor,
                })
              )
            }
          >
            Load more versions
          </button>
        )}
      </section>
    </div>
  );
}

type Verification = {
  status: 'idle' | 'checking' | 'match' | 'mismatch' | 'error';
  message: string;
  actual?: string;
};
function VersionContents({ version }: { version: DocumentVersion }) {
  const [tab, setTab] = useState<'preview' | 'metadata' | 'json'>('preview');
  const [verification, setVerification] = useState<Verification>({
    status: 'idle',
    message: 'File bytes have not been checked in this session.',
  });
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState<'download' | 'local' | null>(null);
  const currentOperation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      currentOperation.current++;
      controller.current?.abort();
    },
    []
  );
  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setNotice('Clipboard is unavailable. You can select and copy the value.');
    }
  };
  const verify = async (file?: File) => {
    const id = ++currentOperation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setOperation(file ? 'local' : 'download');
    setVerification({
      status: 'checking',
      message: file
        ? `Checking ${file.name} locally…`
        : 'Checking the original file before download…',
    });
    try {
      const blob =
        file ||
        (await getVersionContent(
          version.documentId,
          version.versionId,
          abort.signal
        ));
      const bytes = await blob.arrayBuffer();
      const result = await verifyBytes(bytes, {
        sizeBytes: version.file.sizeBytes,
        checksum: version.checksum.value,
      });
      if (id !== currentOperation.current) return;
      setVerification({
        status: result.matches ? 'match' : 'mismatch',
        message: result.matches
          ? file
            ? 'Local file matches this preserved version.'
            : 'Original file matches. Download is ready.'
          : 'Checksum mismatch. These bytes do not match the selected version.',
        actual: result.actual,
      });
      if (result.matches && !file) {
        const url = URL.createObjectURL(
          new Blob([bytes], { type: version.file.mediaType })
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = version.file.name;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      if (id === currentOperation.current && !abort.signal.aborted)
        setVerification({
          status: 'error',
          message: `File verification failed: ${errorMessage(error)}`,
        });
    } finally {
      if (id === currentOperation.current) setOperation(null);
    }
  };
  return (
    <>
      <div className='version-actions'>
        <button
          className='button primary'
          disabled={Boolean(operation)}
          onClick={() => void verify()}
        >
          <Icon name='download' />
          {operation === 'download' ? 'Verifying…' : 'Download original'}
        </button>
        <button
          className='button'
          onClick={() => copy(window.location.href, 'Version link copied')}
        >
          <Icon name='link' />
          Copy version link
        </button>
      </div>
      <section className='checksum-card' aria-label='Version checksum'>
        <div className='section-heading'>
          <div>
            <Icon name='shield' size={17} />
            <h3>Content fingerprint</h3>
          </div>
          <span className='algorithm-badge'>SHA-256</span>
        </div>
        <code data-testid='expected-checksum' className='full-checksum'>
          {version.checksum.value}
        </code>
        <div className='checksum-meta'>
          <span>
            {formatBytes(version.file.sizeBytes)} · Original file bytes
          </span>
          <button
            className='text-button'
            onClick={() => copy(version.checksum.value, 'Full checksum copied')}
          >
            <Icon name='copy' size={13} />
            Copy
          </button>
        </div>
        <div className={`verification ${verification.status}`} role='status'>
          <Icon
            name={verification.status === 'match' ? 'check' : 'shield'}
            size={15}
          />
          <div>
            <strong>
              {
                {
                  idle: 'Not checked',
                  checking: 'Checking file',
                  match: 'Checksum match',
                  mismatch: 'Checksum mismatch',
                  error: 'Verification error',
                }[verification.status]
              }
            </strong>
            <span>{verification.message}</span>
          </div>
        </div>
        {verification.actual && verification.status === 'mismatch' && (
          <div className='actual-checksum'>
            <span>Actual SHA-256</span>
            <code>{verification.actual}</code>
          </div>
        )}
        <button
          className='text-button verify-local'
          disabled={Boolean(operation)}
          onClick={() => fileInput.current?.click()}
        >
          {operation === 'local'
            ? 'Checking local file…'
            : 'Verify a local file against this version'}
          <Icon name='arrow' size={14} />
        </button>
        <input
          type='file'
          ref={fileInput}
          className='visually-hidden'
          aria-label='Choose file to verify'
          tabIndex={-1}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void verify(file);
          }}
        />
      </section>
      {notice && (
        <p role='status' className='inline-notice'>
          {notice}
        </p>
      )}
      <div className='detail-tabs' role='tablist' aria-label='Version content'>
        {(['preview', 'metadata', 'json'] as const).map(name => (
          <button
            key={name}
            id={`tab-${name}`}
            role='tab'
            tabIndex={tab === name ? 0 : -1}
            aria-selected={tab === name}
            aria-controls='version-content'
            onClick={() => setTab(name)}
            onKeyDown={event => {
              const names = ['preview', 'metadata', 'json'] as const;
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              const index =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 2
                    : (names.indexOf(name) +
                        (event.key === 'ArrowRight' ? 1 : 2)) %
                      names.length;
              const next = names[index];
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            {name === 'json'
              ? 'JSON'
              : `${name[0].toUpperCase()}${name.slice(1)}`}
          </button>
        ))}
      </div>
      <section
        id='version-content'
        role='tabpanel'
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className='content-tab'
      >
        {tab === 'preview' ? (
          <FilePreview version={version} />
        ) : tab === 'json' ? (
          <pre className='json-preview'>{JSON.stringify(version, null, 2)}</pre>
        ) : (
          <dl className='metadata-grid'>
            {Object.entries({
              'Version ID': version.versionId,
              'Version name': version.versionName || '—',
              'Document ID': version.documentId,
              'Captured at': formatDateTime(version.capturedAt),
              'Captured by': version.capturedBy,
              'Snapshot title': version.snapshot.title,
              Author: version.snapshot.author,
              Source: version.snapshot.source,
              'Source revision': version.snapshot.sourceRevision || '—',
              'File name': version.file.name,
              'Media type': version.file.mediaType,
              'Exact file size': `${version.file.sizeBytes} bytes`,
              Tags: version.snapshot.tags.join(', '),
            }).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </>
  );
}

function FilePreview({ version }: { version: DocumentVersion }) {
  const [content, setContent] = useState<{
    text?: string;
    url?: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const supported = [
    'application/pdf',
    'text/plain',
    'application/json',
  ].includes(version.file.mediaType);
  useEffect(() => {
    if (!supported) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setContent(null);
    setError('');
    void (async () => {
      try {
        const blob = await getVersionContent(
          version.documentId,
          version.versionId,
          abort.signal
        );
        if (abort.signal.aborted) return;
        if (version.file.mediaType === 'application/pdf') {
          objectUrl = URL.createObjectURL(
            new Blob([blob], { type: 'application/pdf' })
          );
          setContent({ url: objectUrl });
        } else {
          const text = await blob.text();
          if (!abort.signal.aborted) setContent({ text });
        }
      } catch (error) {
        if (!abort.signal.aborted) setError(errorMessage(error));
      }
    })();
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [version, supported, retry]);
  if (!supported)
    return (
      <div className='preview-unavailable'>
        <Icon name='document' size={32} />
        <h3>No preview for this format</h3>
        <p>You can still verify and download the original file.</p>
      </div>
    );
  if (error)
    return (
      <div className='error-banner' role='alert'>
        Cannot load preview: {error}
        <button
          className='text-button'
          onClick={() => setRetry(value => value + 1)}
        >
          Retry preview
        </button>
      </div>
    );
  if (!content)
    return (
      <div className='preview-loading' role='status'>
        Loading file preview…
      </div>
    );
  return (
    <div className='file-preview'>
      <div className='preview-caption'>
        <span>{fileType(version.file.mediaType)} PREVIEW</span>
        <span>Version {version.versionNumber}</span>
      </div>
      {content.url ? (
        <iframe
          title='PDF document preview'
          src={content.url}
          className='pdf-preview'
        />
      ) : (
        <pre className='text-preview'>
          {content.text === '' ? '(Empty file)' : content.text}
        </pre>
      )}
    </div>
  );
}
