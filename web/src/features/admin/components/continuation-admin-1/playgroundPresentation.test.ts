import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSpec } from './playgroundSpec';
import { findReplayEndpoint, loadHistory, saveHistory, MAX_HISTORY } from './playgroundHistory';
import { executeRequest } from './playgroundRequest';
import type { HistoryEntry } from '../ResponseViewer';

vi.mock('@/lib/serverConnection', () => ({
  authHeaders: (headers: Record<string, string>) => headers,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('playground extracted preservation model', () => {
  it('retains referenced parameter/body details, response descriptions and the original tag/method/path order', () => {
    const endpoints = parseSpec({
      components: {
        parameters: { vehicleID: { name: 'vehicleID', in: 'path', required: true, description: 'Full identity', schema: { type: 'integer', default: 42 } } },
        schemas: { Payload: { type: 'object', example: { nested: { retained: true } } } },
      },
      paths: {
        '/vehicles/{vehicleID}': {
          patch: { tags: ['Vehicles'], summary: 'Update vehicle', operationId: 'update',
            parameters: [{ $ref: '#/components/parameters/vehicleID' }],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Payload' } } } },
            responses: { '202': { description: 'Accepted without truncation' } } },
          get: { tags: ['Vehicles'], description: 'Full read description', responses: { '200': { description: 'Ready' } } },
          options: { tags: ['Vehicles'] },
        },
        '/alerts': { delete: { tags: ['Alerts'], responses: {} } },
      },
    });
    expect(endpoints.map(endpoint => `${endpoint.tag}:${endpoint.method}`)).toEqual(['Alerts:DELETE', 'Vehicles:GET', 'Vehicles:PATCH']);
    const patch = endpoints[2];
    expect(patch.parameters).toEqual([{ name: 'vehicleID', in: 'path', required: true, type: 'integer', description: 'Full identity', default: '42' }]);
    expect(patch.requestBody?.example).toEqual({ nested: { retained: true } });
    expect(patch.responses['202'].description).toBe('Accepted without truncation');
    expect(patch.operationId).toBe('update');
  });

  it('preserves session-only history limit and exact-before-template replay without executing a request', () => {
    const entries: HistoryEntry[] = Array.from({ length: MAX_HISTORY + 5 }, (_, index) => ({
      method: 'GET', path: `/vehicles/${index}/state`, status: 200, duration: index, timestamp: '2026-10-06T00:00:00Z',
    }));
    saveHistory(entries);
    expect(loadHistory()).toEqual(entries.slice(0, MAX_HISTORY));
    expect(localStorage.getItem('teslasync-api-playground-history')).toBeNull();
    const endpoints = parseSpec({ paths: {
      '/vehicles/{vehicleID}/state': { get: {} },
      '/vehicles/7/state': { get: {} },
    } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(findReplayEndpoint(endpoints, entries[7])?.path).toBe('/vehicles/7/state');
    expect(findReplayEndpoint(endpoints, entries[8])?.path).toBe('/vehicles/{vehicleID}/state');
    expect(findReplayEndpoint(endpoints, { ...entries[8], method: 'POST' })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains non-JSON response bytes, error status and all headers; GET never sends the editable body', async () => {
    const body = 'upstream failure\n<not-json>& exact\n';
    const fetch = vi.fn().mockResolvedValue(new Response(body, {
      status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/plain', 'x-evidence': 'full-value' },
    }));
    vi.stubGlobal('fetch', fetch);
    const response = await executeRequest('/vehicles/42/state', 'GET', '{"doNotSend":true}', { 'x-test': 'retained' });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/vehicles/42/state'), expect.objectContaining({
      method: 'GET', credentials: 'same-origin', headers: { 'x-test': 'retained' },
    }));
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('body');
    expect(response.status).toBe(502);
    expect(response.statusText).toBe('Bad Gateway');
    expect(response.body).toBe(body);
    expect(response.bodyText).toBe(body);
    expect(response.size).toBe(new Blob([body]).size);
    expect(response.headers['x-evidence']).toBe('full-value');
  });
});
