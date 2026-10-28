import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { loadRecords } from '@/store/modules/records/thunks';
import { selectRecords } from '@/store/modules/records/selectors';
import { Icon } from '@/components/Icon';
import { errorMessage } from '@/services/api';
import {
  decodeSearchLink,
  encodeSearchLink,
  preferenceKey,
  readPreferences,
} from './preferences';
import type {
  EntityDefinition,
  EntitySchema,
  SearchFilter,
  SearchQuery,
} from './types';
import { RecordTable } from './RecordTable';
import { AccountControl } from '@/auth/AccountControl';
import { useAuth } from '@/auth/context';

const operatorLabels = {
  equals: 'is exactly',
  contains: 'contains',
  notEquals: 'is not',
  greaterThan: 'is greater than',
  lessThan: 'is less than',
};
function safeStorage(): Pick<Storage, 'getItem'> {
  try {
    return localStorage;
  } catch {
    return { getItem: () => null };
  }
}

export function ExplorerLayout({ entity }: { entity: EntityDefinition }) {
  const [schema, setSchema] = useState<EntitySchema | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSchema(null);
    setError('');
    entity.adapter
      .loadSchema(controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setSchema(value);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [entity, attempt]);
  if (!schema)
    return (
      <div className='startup'>
        <Icon name='library' size={32} />
        <h1>Document Vault</h1>
        <p>{error || 'Opening your document library…'}</p>
        {error && (
          <button
            className='button primary'
            onClick={() => setAttempt(value => value + 1)}
          >
            Try again
          </button>
        )}
      </div>
    );
  return <ExplorerWorkspace key={entity.id} entity={entity} schema={schema} />;
}

function ExplorerWorkspace({
  entity,
  schema,
}: {
  entity: EntityDefinition;
  schema: EntitySchema;
}) {
  const { user } = useAuth();
  const preferenceScope = user ? `${user.id}:${entity.id}` : entity.id;
  const fields = schema.fields.map(field => field.name);
  const [preferences, setPreferences] = useState(() =>
    readPreferences({ ...entity, id: preferenceScope }, fields, safeStorage())
  );
  const [draft, setDraft] = useState(preferences.query.text);
  const [feedback, setFeedback] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('document-vault:theme') === 'dark'
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  });
  const [reload, setReload] = useState(0);
  const [params] = useSearchParams();
  const encoded = params.get('search');
  const dispatch = useAppDispatch();
  const records = useAppSelector(selectRecords);
  const { recordId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const query = preferences.query;

  useEffect(() => {
    if (!encoded) return;
    try {
      const next = decodeSearchLink(
        encoded,
        entity.id,
        schema.fields.map(field => field.name)
      );
      setPreferences(previous => ({ ...previous, query: next }));
      setDraft(next.text);
    } catch (error) {
      setFeedback(errorMessage(error));
    }
  }, [encoded, entity.id, schema]);

  useEffect(() => {
    const promise = dispatch(loadRecords({ entityId: entity.id, query }));
    return () => promise.abort();
  }, [dispatch, entity.id, query, reload]);

  useEffect(() => {
    try {
      localStorage.setItem(
        preferenceKey(preferenceScope),
        JSON.stringify(preferences)
      );
    } catch {
      /* The current session remains usable without browser storage. */
    }
  }, [preferenceScope, preferences]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('document-vault:theme', theme);
    } catch {
      /* Theme still applies to the current page. */
    }
  }, [theme]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(''), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const closeDetails = useCallback(() => {
    navigate({ pathname: entity.routeBase, search: location.search });
  }, [navigate, entity.routeBase, location.search]);
  const setQuery = (next: SearchQuery) =>
    setPreferences(previous => ({ ...previous, query: next }));
  const openRecord = (id: string) =>
    navigate({
      pathname: `${entity.routeBase}/${encodeURIComponent(id)}`,
      search: location.search,
    });
  const shareSearch = async () => {
    try {
      const url = new URL(entity.routeBase, locationOrigin());
      url.searchParams.set('search', encodeSearchLink(entity.id, query));
      await navigator.clipboard.writeText(url.toString());
      setFeedback('Search link copied');
    } catch {
      setFeedback('Cannot copy the search link');
    }
  };
  const quickFilter = (filters: SearchFilter[]) => {
    setDraft('');
    setQuery({ ...entity.defaultQuery, filters });
  };

  return (
    <>
      <div className='app-frame' inert={Boolean(recordId) || filterOpen}>
        <aside className='sidebar'>
          <a className='brand' href={entity.routeBase}>
            <span className='brand-mark'>
              <Icon name='document' size={23} />
            </span>
            <span>
              Document<span className='brand-sub'>Vault</span>
            </span>
          </a>
          <div className='workspace-name'>
            <span className='workspace-initial'>D</span>
            <div>
              Documentation<span>Personal workspace</span>
            </div>
            <span className='workspace-dot' />
          </div>
          <span className='nav-heading'>WORKSPACE</span>
          <nav aria-label='Document collections'>
            {entity.collections.map((collection, index) => (
              <button
                key={collection.label}
                className={`nav-item ${JSON.stringify(query.filters) === JSON.stringify(collection.filters) ? 'active' : ''}`}
                onClick={() => quickFilter(collection.filters)}
              >
                <Icon name={index === 0 ? 'library' : 'folder'} />
                {collection.label}
                {index === 0 && (
                  <span className='nav-count'>
                    {records.loading ? '—' : records.total}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className='sidebar-note'>
            <Icon name='shield' size={24} />
            <strong>Every version, preserved.</strong>
            <p>
              Stable snapshots. Original files.
              <br />
              Verifiable down to the byte.
            </p>
          </div>
          <div className='sidebar-bottom'>
            <span className='local-dot' />
            Local demonstration
            <span className='sidebar-caption'>Read-only · Mock data</span>
          </div>
        </aside>
        <main className='main-content'>
          <header className='topbar'>
            <div className='breadcrumb'>
              <Icon name='folder' size={16} />
              <span>Workspace</span>
              <span>/</span>
              <strong>{entity.name}</strong>
            </div>
            <div className='topbar-actions'>
              <span className='demo-badge'>LOCAL DEMO</span>
              <button
                className='icon-button'
                aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
                onClick={() =>
                  setTheme(value => (value === 'light' ? 'dark' : 'light'))
                }
              >
                <Icon name={theme === 'light' ? 'moon' : 'sun'} />
              </button>
              <AccountControl />
            </div>
          </header>
          <div className='page-content'>
            <section className='page-heading'>
              <div>
                <div className='eyebrow'>YOUR KNOWLEDGE, KEPT INTACT</div>
                <h1>
                  Document library<span className='heading-dot'>.</span>
                </h1>
                <p>{entity.description}</p>
              </div>
              <div className='heading-actions'>
                {entity.Actions && (
                  <entity.Actions
                    onChanged={() => setReload(value => value + 1)}
                  />
                )}{' '}
                <button className='button' onClick={shareSearch}>
                  <Icon name='link' />
                  Share search
                </button>
              </div>
            </section>
            <div className='summary-strip'>
              <div>
                <span className='summary-icon'>
                  <Icon name='document' />
                </span>
                <div>
                  <strong>{records.loading ? '—' : records.total}</strong>
                  <span>Documents in this view</span>
                </div>
              </div>
              <div>
                <span className='summary-icon'>
                  <Icon name='clock' />
                </span>
                <div>
                  <strong>Version history</strong>
                  <span>Every snapshot has its own link</span>
                </div>
              </div>
              <div>
                <span className='summary-icon'>
                  <Icon name='shield' />
                </span>
                <div>
                  <strong>SHA-256</strong>
                  <span>Exact original-file verification</span>
                </div>
              </div>
            </div>
            <section className='library-card' aria-label='Document library'>
              <div className='collection-heading'>
                <div>
                  <h2>All {entity.name.toLowerCase()}</h2>
                  <span className='count-badge'>
                    {records.loading ? '…' : records.total}
                  </span>
                </div>
                <span className='subtle'>Latest versions shown</span>
              </div>
              <div className='toolbar'>
                <form
                  className='search-box'
                  onSubmit={event => {
                    event.preventDefault();
                    setQuery({ ...query, text: draft });
                  }}
                >
                  <Icon name='search' />
                  <input
                    aria-label={`Search ${entity.name.toLowerCase()}`}
                    placeholder={entity.searchPlaceholder}
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                  />
                  <button type='submit' className='search-submit'>
                    Search
                  </button>
                </form>
                <button className='button' onClick={() => setFilterOpen(true)}>
                  <Icon name='filter' />
                  Filters
                  {query.filters.length > 0 && (
                    <span className='small-count'>{query.filters.length}</span>
                  )}
                </button>
                <div className='column-control'>
                  <button
                    className='button'
                    aria-expanded={columnsOpen}
                    onClick={() => setColumnsOpen(value => !value)}
                  >
                    <Icon name='columns' />
                    Columns
                  </button>
                  {columnsOpen && (
                    <div className='column-menu'>
                      <strong>Visible columns</strong>
                      {schema.fields.map(field => (
                        <label key={field.name}>
                          <input
                            type='checkbox'
                            checked={preferences.columns.includes(field.name)}
                            disabled={
                              preferences.columns.length === 1 &&
                              preferences.columns.includes(field.name)
                            }
                            onChange={event =>
                              setPreferences(previous => ({
                                ...previous,
                                columns: event.target.checked
                                  ? [...previous.columns, field.name]
                                  : previous.columns.filter(
                                      name => name !== field.name
                                    ),
                              }))
                            }
                          />
                          {field.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className='icon-button'
                  aria-label='Refresh library'
                  onClick={() => setReload(value => value + 1)}
                >
                  <Icon name='refresh' />
                </button>
              </div>
              {(query.filters.length > 0 || query.timeRange || query.text) && (
                <div className='filter-chips'>
                  {query.text && (
                    <span className='filter-chip'>
                      Search: {query.text}
                      <button
                        aria-label='Clear search'
                        onClick={() => {
                          setDraft('');
                          setQuery({ ...query, text: '' });
                        }}
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {query.filters.map((filter, index) => (
                    <span className='filter-chip' key={index}>
                      {
                        schema.fields.find(field => field.name === filter.field)
                          ?.label
                      }{' '}
                      {operatorLabels[filter.operator]} {filter.value}
                      <button
                        aria-label={`Remove filter ${index + 1}`}
                        onClick={() =>
                          setQuery({
                            ...query,
                            filters: query.filters.filter(
                              (_, position) => position !== index
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {query.timeRange && (
                    <span className='filter-chip'>
                      Capture date range
                      <button
                        aria-label='Remove date range'
                        onClick={() => setQuery({ ...query, timeRange: null })}
                      >
                        ×
                      </button>
                    </span>
                  )}
                  <button
                    className='text-button'
                    onClick={() => {
                      setDraft('');
                      setQuery(entity.defaultQuery);
                    }}
                  >
                    Clear all
                  </button>
                </div>
              )}
              {records.error && (
                <div className='error-banner' role='alert'>
                  {records.error}
                  <button
                    className='text-button'
                    onClick={() => setReload(value => value + 1)}
                  >
                    Try again
                  </button>
                </div>
              )}
              <RecordTable
                entity={entity}
                schema={schema}
                columns={preferences.columns}
                records={records.items}
                loading={records.loading}
                onOpen={openRecord}
                onChanged={() => setReload(value => value + 1)}
                query={query}
                onSort={sort => setQuery({ ...query, sort })}
              />
              <div className='table-footer'>
                <span>
                  {records.loading
                    ? 'Loading documents…'
                    : `${records.items.length} of ${records.total} documents`}
                </span>
                {records.nextCursor && (
                  <button
                    className='button compact'
                    disabled={records.loadingMore}
                    onClick={() =>
                      dispatch(
                        loadRecords({
                          entityId: entity.id,
                          query,
                          cursor: records.nextCursor,
                        })
                      )
                    }
                  >
                    {records.loadingMore ? 'Loading…' : 'Load more documents'}
                    <Icon name='arrow' size={14} />
                  </button>
                )}
              </div>
            </section>
            <footer className='page-footer'>
              <Icon name='shield' size={14} />A document can evolve. A captured
              version stays the same.
              <span>Document Vault · Local workspace</span>
            </footer>
          </div>
        </main>
      </div>
      {recordId && (
        <DetailShell title={entity.singularName} onClose={closeDetails}>
          <entity.Details
            recordId={recordId}
            onClose={closeDetails}
            onChanged={() => setReload(value => value + 1)}
          />
        </DetailShell>
      )}
      {filterOpen && (
        <FilterDialog
          schema={schema}
          onClose={() => setFilterOpen(false)}
          onAdd={filter => {
            setQuery({ ...query, filters: [...query.filters, filter] });
            setFilterOpen(false);
          }}
          onDates={timeRange => {
            setQuery({ ...query, timeRange });
            setFilterOpen(false);
          }}
        />
      )}
      {feedback && (
        <div className='toast' role='status'>
          {feedback}
        </div>
      )}
    </>
  );
}

function locationOrigin() {
  return window.location.origin;
}

export function DetailShell({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const layer = dialog.current?.closest('.modal-layer');
    const background = Array.from(
      document.querySelectorAll<HTMLElement>('.app-frame, .modal-layer')
    ).filter(element => element !== layer);
    const previousInert = background.map(element => element.inert);
    background.forEach(element => {
      element.inert = true;
    });
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return createPortal(
    <div className='modal-layer'>
      <button
        className='modal-backdrop'
        aria-label='Close details backdrop'
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className='detail-shell'
        ref={dialog}
        tabIndex={-1}
        role='dialog'
        aria-modal='true'
        aria-label={`${title} details`}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            event.stopPropagation();
            const focusable = dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled):not([tabindex="-1"]), select, textarea, iframe, [tabindex="0"]'
            );
            if (!focusable?.length) return;
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button
          className='icon-button detail-close'
          aria-label={`Close ${title.toLowerCase()} details`}
          onClick={onClose}
        >
          <Icon name='close' />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}

function FilterDialog({
  schema,
  onClose,
  onAdd,
  onDates,
}: {
  schema: EntitySchema;
  onClose(): void;
  onAdd(filter: SearchFilter): void;
  onDates(range: { from: number; to: number }): void;
}) {
  const [field, setField] = useState(schema.fields[0].name);
  const [operator, setOperator] =
    useState<SearchFilter['operator']>('contains');
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const numeric = ['number', 'date', 'bytes'].includes(
    schema.fields.find(item => item.name === field)?.type || ''
  );
  return (
    <DetailShell title='Filter' onClose={onClose}>
      <div className='filter-dialog'>
        <div className='eyebrow'>REFINE YOUR LIBRARY</div>
        <h2>Add a filter</h2>
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!value.trim()) return;
            if (
              numeric &&
              ['greaterThan', 'lessThan'].includes(operator) &&
              !Number.isFinite(Number(value))
            ) {
              setError('Enter a valid number');
              return;
            }
            onAdd({ field, operator, value: value.trim() });
          }}
        >
          <label>
            Field
            <select
              value={field}
              onChange={event => {
                setField(event.target.value);
                setOperator('contains');
              }}
            >
              {schema.fields.map(field => (
                <option key={field.name} value={field.name}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Condition
            <select
              value={operator}
              onChange={event =>
                setOperator(event.target.value as SearchFilter['operator'])
              }
            >
              {Object.entries(operatorLabels)
                .filter(
                  ([key]) =>
                    numeric || !['greaterThan', 'lessThan'].includes(key)
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Value
            <input
              value={value}
              onChange={event => setValue(event.target.value)}
              required
              placeholder='Enter a value'
            />
          </label>
          {error && (
            <p role='alert' className='error-text'>
              {error}
            </p>
          )}
          <button className='button primary' type='submit'>
            Add filter
          </button>
        </form>
        <hr />
        <h3>Capture date range</h3>
        <p className='subtle'>Optional. Dates are interpreted in UTC.</p>
        <form
          onSubmit={event => {
            event.preventDefault();
            const start = Date.parse(`${from}T00:00:00Z`) / 1000;
            const end = Date.parse(`${to}T23:59:59Z`) / 1000;
            if (
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              start > end
            ) {
              setError('Select a valid date range');
              return;
            }
            onDates({ from: start, to: end });
          }}
        >
          <label>
            From
            <input
              type='date'
              required
              value={from}
              onChange={event => setFrom(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type='date'
              required
              value={to}
              onChange={event => setTo(event.target.value)}
            />
          </label>
          <button className='button' type='submit'>
            Apply date range
          </button>
        </form>
      </div>
    </DetailShell>
  );
}
