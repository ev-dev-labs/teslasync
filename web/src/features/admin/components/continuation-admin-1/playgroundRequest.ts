import { apiUrl } from '@/api/client';
import { authHeaders } from '@/lib/serverConnection';
import type { ApiResponse } from '../ResponseViewer';

/** Interactive transport retains raw non-JSON/error responses for the inspector. */
export async function executeRequest(
  url: string, method: string, body?: string, headers?: Record<string, string>,
): Promise<ApiResponse> {
  const start = performance.now();
  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: authHeaders({
      ...(body && method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    }),
  };
  if (body && method !== 'GET') options.body = body;
  const response = await fetch(apiUrl(url), options);
  const duration = Math.round(performance.now() - start);
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const size = new Blob([text]).size;
  let parsed: unknown = text;
  if (contentType.includes('json')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // The response inspector must retain malformed JSON verbatim.
    }
  }
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => { responseHeaders[key] = value; });
  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: parsed,
    bodyText: text,
    duration,
    size,
    contentType,
  };
}
