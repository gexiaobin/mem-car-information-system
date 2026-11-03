export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const multipart = options.body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, { ...options, credentials: 'include', headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(payload?.error?.code || 'REQUEST_FAILED', payload?.error?.message || '服务暂时不可用，请稍后重试', response.status);
  return payload as T;
}
export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
