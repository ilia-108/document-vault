import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { DetailShell } from '@/explorer/ExplorerLayout';
import { Icon } from '@/components/Icon';
import { ApiError, errorMessage, requestJson } from '@/services/api';
import { object, parseDocument, parseVersion } from './validation';
import type { DocumentSummary, DocumentVersion } from './types';

interface EncryptionSettings {
  encryptByDefault: boolean;
  allowPerFileOverride: boolean;
  keyProviderConfigured: boolean;
}
function parseSettings(value: unknown): EncryptionSettings {
  const settings = object(value);
  if (
    typeof settings.encryptByDefault !== 'boolean' ||
    typeof settings.allowPerFileOverride !== 'boolean' ||
    typeof settings.keyProviderConfigured !== 'boolean'
  )
    throw new Error('Invalid encryption settings');
  return settings as unknown as EncryptionSettings;
}
const getSettings = (signal?: AbortSignal) =>
  requestJson('v1/settings/encryption', parseSettings, { signal });
export function DocumentActions({ onChanged }: { onChanged(): void }) {
  const [dialog, setDialog] = useState<'upload' | 'settings' | null>(null);
  const navigate = useNavigate();
  if (window.runtimeConfig?.MODE !== 'server') return null;
  return (
    <>
      <button className='button' onClick={() => setDialog('settings')}>
        <Icon name='shield' />
        Encryption settings
      </button>
      <button className='button primary' onClick={() => setDialog('upload')}>
        <Icon name='document' />
        Add document
      </button>
      {dialog === 'settings' && (
        <EncryptionDialog onClose={() => setDialog(null)} />
      )}{' '}
      {dialog === 'upload' && (
        <UploadDialog
          onClose={() => setDialog(null)}
          onCreated={result => {
            setDialog(null);
            onChanged();
            navigate(
              `/documents/${result.document.documentId}/versions/${result.version.versionId}`
            );
          }}
        />
      )}
    </>
  );
}
export function UploadVersionButton({
  document,
  onCreated,
}: {
  document: DocumentSummary;
  onCreated(version: DocumentVersion): void;
}) {
  const [open, setOpen] = useState(false);
  if (window.runtimeConfig?.MODE !== 'server') return null;
  return (
    <>
      <button className='button' onClick={() => setOpen(true)}>
        Add version
      </button>
      {open && (
        <UploadDialog
          document={document}
          onClose={() => setOpen(false)}
          onCreated={result => {
            setOpen(false);
            onCreated(result.version);
          }}
        />
      )}
    </>
  );
}
function EncryptionDialog({ onClose }: { onClose(): void }) {
  const [settings, setSettings] = useState<EncryptionSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void getSettings(controller.signal)
      .then(setSettings)
      .catch(error => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, []);
  return (
    <DetailShell title='Encryption settings' onClose={onClose}>
      <div className='filter-dialog'>
        <div className='eyebrow'>WORKSPACE SECURITY</div>
        <h2>File encryption</h2>
        <p className='subtle'>
          These settings apply to new uploads in your account.
        </p>
        {error && (
          <p role='alert' className='error-text'>
            {error}
          </p>
        )}
        {settings ? (
          <form
            onSubmit={async event => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                await requestJson('v1/settings/encryption', parseSettings, {
                  method: 'PUT',
                  body: {
                    encryptByDefault: settings.encryptByDefault,
                    allowPerFileOverride: settings.allowPerFileOverride,
                  },
                });
                onClose();
              } catch (error) {
                setError(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className='setting-checkbox'>
              <input
                type='checkbox'
                checked={settings.encryptByDefault}
                onChange={event =>
                  setSettings({
                    ...settings,
                    encryptByDefault: event.target.checked,
                  })
                }
              />
              <span>
                Encrypt new files by default
                <small>
                  Enabled by default. Protect original file bytes at rest.
                </small>
              </span>
            </label>
            <label className='setting-checkbox'>
              <input
                type='checkbox'
                checked={settings.allowPerFileOverride}
                onChange={event =>
                  setSettings({
                    ...settings,
                    allowPerFileOverride: event.target.checked,
                  })
                }
              />
              <span>
                Allow encryption choices for individual uploads
                <small>
                  Show an encryption checkbox when adding a file or version.
                </small>
              </span>
            </label>
            <div className='development-note'>
              Once a document has an encrypted version, all future versions must
              be encrypted. Changing these settings cannot unlock it. Existing
              versions are preserved.
            </div>
            <p className='subtle'>
              Key provider: OpenBao Transit.{' '}
              {settings.keyProviderConfigured
                ? 'Configured.'
                : 'Not configured; encrypted uploads will be rejected.'}
            </p>
            <button className='button primary' type='submit' disabled={busy}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        ) : (
          !error && <p role='status'>Loading settings…</p>
        )}
      </div>
    </DetailShell>
  );
}
interface UploadReview {
  confirmationToken: string;
  duplicateVersions: {
    versionId: string;
    versionNumber: number;
    versionName?: string;
  }[];
  extensionChange?: { first: string; latest: string; incoming: string };
  reuseFile: boolean;
}
function parseReview(value: unknown): UploadReview {
  const review = object(value);
  if (
    typeof review.confirmationToken !== 'string' ||
    !Array.isArray(review.duplicateVersions) ||
    review.duplicateVersions.some(value => {
      const ref = object(value);
      return (
        typeof ref.versionId !== 'string' ||
        !ref.versionId ||
        !Number.isSafeInteger(ref.versionNumber) ||
        Number(ref.versionNumber) < 1 ||
        (ref.versionName !== undefined && typeof ref.versionName !== 'string')
      );
    }) ||
    (review.extensionChange !== undefined &&
      !['first', 'latest', 'incoming'].every(
        key => typeof object(review.extensionChange)[key] === 'string'
      )) ||
    typeof review.reuseFile !== 'boolean'
  )
    throw new Error('Invalid upload confirmation');
  return review as unknown as UploadReview;
}
function UploadDialog({
  document,
  onClose,
  onCreated,
}: {
  document?: DocumentSummary;
  onClose(): void;
  onCreated(result: {
    document: DocumentSummary;
    version: DocumentVersion;
  }): void;
}) {
  const [settings, setSettings] = useState<EncryptionSettings | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [versionName, setVersionName] = useState('');
  const [encrypted, setEncrypted] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<UploadReview | null>(null);
  const required = document?.encryptionRequired === true;
  useEffect(() => {
    const controller = new AbortController();
    void getSettings(controller.signal)
      .then(value => {
        setSettings(value);
        setEncrypted(required || value.encryptByDefault);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [required]);
  return (
    <DetailShell
      title={document ? 'New version' : 'New document'}
      onClose={busy ? () => {} : onClose}
    >
      <div className='filter-dialog'>
        <div className='eyebrow'>PRESERVE AN ORIGINAL</div>
        <h2>
          {document ? `Add a version of ${document.title}` : 'Add a document'}
        </h2>
        <form
          onSubmit={async event => {
            event.preventDefault();
            if (!file || !settings) return;
            if (file.size > 25 * 1024 * 1024) {
              setError('Files must be at most 25 MiB');
              return;
            }
            setBusy(true);
            setError('');
            try {
              const body = new FormData();
              body.append('file', file);
              if (review)
                body.append('confirmationToken', review.confirmationToken);
              if (!document) body.append('title', title.trim());
              if (versionName.trim())
                body.append('versionName', versionName.trim());
              if (settings.allowPerFileOverride && !required)
                body.append('encrypt', String(encrypted));
              const result = await requestJson(
                document
                  ? `v1/documents/${encodeURIComponent(document.documentId)}/versions`
                  : 'v1/documents',
                value => {
                  const result = object(value);
                  return {
                    document: parseDocument(result.document),
                    version: parseVersion(result.version),
                  };
                },
                { body }
              );
              onCreated(result);
            } catch (error) {
              if (
                error instanceof ApiError &&
                error.code === 'upload_confirmation_required'
              ) {
                try {
                  setReview(parseReview(error.data));
                } catch (parseError) {
                  setError(errorMessage(parseError));
                }
              } else setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset
            disabled={busy}
            className='upload-fields'
            onChange={() => setReview(null)}
          >
            {!document && (
              <label>
                Document title
                <input
                  required
                  maxLength={300}
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                />
              </label>
            )}
            <label>
              Original file
              <input
                type='file'
                required
                disabled={busy}
                onChange={event => {
                  const selected = event.target.files?.[0] || null;
                  setFile(selected);
                  if (selected && !title)
                    setTitle(selected.name.replace(/\.[^.]+$/, ''));
                }}
              />
              <span className='subtle'>
                Up to 25 MiB. Confirmed identical versions can share a stored
                file.
              </span>
            </label>
            <label>
              Version name (optional)
              <input
                maxLength={200}
                value={versionName}
                onChange={event => setVersionName(event.target.value)}
                placeholder='For example: Approved for publication'
              />
            </label>
            {required ? (
              <div className='development-note'>
                <Icon name='shield' size={16} />
                Encryption is required for every new version of this document.
              </div>
            ) : settings?.allowPerFileOverride ? (
              <label className='setting-checkbox'>
                <input
                  type='checkbox'
                  checked={encrypted}
                  onChange={event => setEncrypted(event.target.checked)}
                />
                <span>Encrypt this file</span>
              </label>
            ) : (
              settings && (
                <p className='subtle'>
                  Encryption:{' '}
                  {settings.encryptByDefault ? 'enabled' : 'disabled'} by
                  workspace settings.
                </p>
              )
            )}
          </fieldset>
          {review && (
            <div className='upload-review' role='alert'>
              <h3>Review this version</h3>
              {review.duplicateVersions.length > 0 && (
                <>
                  <p>
                    This file has identical content to{' '}
                    {review.duplicateVersions
                      .map(
                        v =>
                          `version ${v.versionNumber}${v.versionName ? ` (${v.versionName})` : ''}`
                      )
                      .join(', ')}
                    .
                  </p>
                  <p>
                    {review.reuseFile
                      ? 'A new version will reference the existing stored file.'
                      : 'Encryption requires a separate encrypted copy of this content.'}
                  </p>
                </>
              )}
              {review.extensionChange && (
                <p>
                  File extension changed: first version{' '}
                  {review.extensionChange.first || '(none)'}, latest version{' '}
                  {review.extensionChange.latest || '(none)'}, incoming file{' '}
                  {review.extensionChange.incoming || '(none)'}.
                </p>
              )}
              <p>Add this version only if these changes are intended.</p>
            </div>
          )}
          {error && (
            <p className='error-text' role='alert'>
              {error}
            </p>
          )}
          <button
            className='button primary'
            type='submit'
            disabled={busy || !settings}
          >
            {busy
              ? 'Preserving file…'
              : review
                ? 'Add version anyway'
                : document
                  ? 'Create version'
                  : 'Create document'}
          </button>
        </form>
      </div>
    </DetailShell>
  );
}
