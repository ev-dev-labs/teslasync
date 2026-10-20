// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getConnectionStatus, onStatusChange } from '../resilience';

describe('resilience node import', () => {
  it('imports without a DOM and exposes the status API', () => {
    expect(typeof window).toBe('undefined');
    expect(['online', 'offline']).toContain(getConnectionStatus());
    const off = onStatusChange(() => {});
    expect(typeof off).toBe('function');
    off();
  });
});
