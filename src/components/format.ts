export function formatBytes(value: number): string {
  if (value === 0) return '0 B';
  if (value < 1024) return `${value} B`;
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** power).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][power]}`;
}
export function formatDate(seconds: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(seconds * 1000));
}
export function formatDateTime(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}
export function fileType(mime: string): string {
  return (
    {
      'application/pdf': 'PDF',
      'text/plain': 'TXT',
      'application/json': 'JSON',
    }[mime] || 'FILE'
  );
}
