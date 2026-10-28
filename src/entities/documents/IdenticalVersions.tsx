import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { DocumentVersion } from './types';

export function IdenticalVersions({ version }: { version: DocumentVersion }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const location = useLocation();
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  if (!version.identicalVersions?.length) return null;
  return (
    <div
      ref={root}
      className='identical-versions'
      onMouseEnter={() => {
        cancel();
        setOpen(true);
      }}
      onMouseLeave={() => {
        cancel();
        timer.current = setTimeout(() => setOpen(false), 180);
      }}
      onFocus={() => {
        cancel();
        setOpen(true);
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          button.current?.focus();
          setOpen(false);
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setOpen(true);
          setTimeout(() => root.current?.querySelector('a')?.focus(), 0);
        }
      }}
    >
      <button
        ref={button}
        className='identical-chip'
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup='dialog'
        onClick={() => setOpen(true)}
      >
        ↔ Identical versions
      </button>
      {open && (
        <div
          id={id}
          role='dialog'
          aria-label={`Versions identical to version ${version.versionNumber}`}
          className='identical-popover'
        >
          <strong>Same file contents</strong>
          <p>Exact SHA-256 match</p>
          <div className='identical-links'>
            {version.identicalVersions.map(ref => (
              <Link
                key={ref.versionId}
                to={{
                  pathname: `/documents/${encodeURIComponent(version.documentId)}/versions/${encodeURIComponent(ref.versionId)}`,
                  search: location.search,
                }}
                onClick={() => setOpen(false)}
              >
                Version {ref.versionNumber}
                {ref.versionName && <span>{ref.versionName}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
