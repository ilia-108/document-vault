import type { CSSProperties } from 'react';

const paths = {
  document:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6',
  library: 'M3 3h5v18H3z M10 3h5v18h-5z M17 4l4-1 4 17-4 1z',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  check: 'M20 6L9 17l-5-5',
  shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6',
  clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  chevron: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12 M18 6L6 18',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
  copy: 'M8 8h12v13H8z M16 8V3H3v13h5',
  filter: 'M4 6h16 M7 12h10 M10 18h4',
  columns: 'M3 4h18v16H3z M9 4v16 M15 4v16',
  refresh: 'M20 7V3l-3 3a8 8 0 1 0 3 9 M20 7h-5',
  sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12',
  link: 'M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3 M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3',
  folder: 'M3 5h6l2 3h10v12H3z',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
} as const;
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 26 26'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
