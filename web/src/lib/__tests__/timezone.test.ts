import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveTimezone, browserTimezone } from '../timezone';

describe('resolveTimezone', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns UTC for utc mode regardless of vehicle/user override', () => {
    expect(resolveTimezone('utc')).toBe('UTC');
    expect(resolveTimezone('utc', 'America/New_York', 'Europe/Paris')).toBe('UTC');
  });

  it('uses the user override for user mode when provided', () => {
    expect(resolveTimezone('user', 'America/New_York', 'Europe/Paris')).toBe('Europe/Paris');
  });

  it('falls back to the browser tz for user mode when override is empty', () => {
    const browserTz = browserTimezone();
    expect(resolveTimezone('user', 'America/New_York', '')).toBe(browserTz);
    expect(resolveTimezone('user', 'America/New_York')).toBe(browserTz);
  });

  it('returns the vehicle tz for vehicle mode when present and not UTC', () => {
    expect(resolveTimezone('vehicle', 'America/Los_Angeles')).toBe('America/Los_Angeles');
  });

  it('falls back to user TZ for vehicle mode when vehicle tz is empty/UTC', () => {
    expect(resolveTimezone('vehicle', undefined, 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveTimezone('vehicle', '', 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveTimezone('vehicle', 'UTC', 'Europe/Berlin')).toBe('Europe/Berlin');
  });

  it('falls back to browser tz when both vehicle and user are unset', () => {
    const browserTz = browserTimezone();
    expect(resolveTimezone('vehicle', null, null)).toBe(browserTz);
    expect(resolveTimezone('vehicle', 'UTC', '')).toBe(browserTz);
  });
});

describe('browserTimezone', () => {
  it('returns a non-empty IANA-looking string', () => {
    const tz = browserTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
});
