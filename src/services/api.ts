declare global {
  interface Window {
    runtimeConfig?: { API_BASE_URL: string; MODE?: string };
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
function apiUrl(path: string) {
  const base = window.runtimeConfig?.API_BASE_URL;
  if (!base) throw new Error('API runtime configuration is missing');
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
async function request(
  path: string,
  options: { signal?: AbortSignal; body?: unknown; method?: string } = {}
) {
  const response = await fetch(apiUrl(path), {
    method: options.method || (options.body === undefined ? 'GET' : 'POST'),
    headers:
      options.body === undefined || options.body instanceof FormData
        ? undefined
        : { 'Content-Type': 'application/json' },
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
    signal: options.signal,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/'))
      window.dispatchEvent(new Event('document-vault:session-expired'));
    const error = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      error?.error || `Request failed (${response.status})`,
      error?.data,
      error?.code
    );
  }
  return response;
}
export async function requestJson<T>(
  path: string,
  decode: (data: unknown) => T,
  options: { signal?: AbortSignal; body?: unknown; method?: string } = {}
): Promise<T> {
  const response = await request(path, options);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('data' in payload))
    throw new Error('Invalid API response');
  return decode(payload.data);
}
export async function requestBlob(
  path: string,
  signal?: AbortSignal
): Promise<Blob> {
  return (await request(path, { signal })).blob();
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
