import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveTimezone, browserTimezone, isValidTimezone, sanitizeTimezone } from '../timezone';
import { resolveRawTimezone } from '../dateConvert';

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

  it('falls back to the browser tz when the user override is not a real zone', () => {
    const browserTz = browserTimezone();
    expect(resolveTimezone('user', 'America/New_York', 'Mars/Olympus_Mons')).toBe(browserTz);
    expect(resolveTimezone('user', 'America/New_York', 'UTC+5')).toBe(browserTz);
    expect(resolveTimezone('user', 'America/New_York', '   ')).toBe(browserTz);
  });

  it('ignores an invalid vehicle tz and falls back to the user tz', () => {
    expect(resolveTimezone('vehicle', 'Not/AZone', 'Europe/Berlin')).toBe('Europe/Berlin');
    const browserTz = browserTimezone();
    expect(resolveTimezone('vehicle', 'Not/AZone', '')).toBe(browserTz);
    expect(resolveTimezone('vehicle', 'Not/AZone')).toBe(browserTz);
  });

  it('accepts a padded override by trimming it', () => {
    expect(resolveTimezone('user', null, '  Europe/Paris  ')).toBe('Europe/Paris');
  });

  it('never returns an invalid zone from any mode', () => {
    for (const mode of ['vehicle', 'user', 'utc'] as const) {
      expect(isValidTimezone(resolveTimezone(mode, 'Bogus/Zone', 'Also/Bogus'))).toBe(true);
    }
  });
});

describe('isValidTimezone', () => {
  it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Europe/Paris'])('accepts %s', (tz) => {
    expect(isValidTimezone(tz)).toBe(true);
  });

  it.each(['', '   ', 'Mars/Olympus_Mons', 'UTC+5', 'America/Los Angeles', null, undefined, 42])(
    'rejects %s',
    (tz) => {
      expect(isValidTimezone(tz)).toBe(false);
    },
  );
});

describe('sanitizeTimezone', () => {
  it('returns the candidate when it is a real zone', () => {
    expect(sanitizeTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('falls back to the browser tz for invalid candidates', () => {
    const browserTz = browserTimezone();
    expect(sanitizeTimezone('Mars/Olympus_Mons')).toBe(browserTz);
    expect(sanitizeTimezone('')).toBe(browserTz);
    expect(sanitizeTimezone(null)).toBe(browserTz);
  });

  it('prefers an explicit valid fallback over the browser tz', () => {
    expect(sanitizeTimezone('Bogus/Zone', 'Europe/Berlin')).toBe('Europe/Berlin');
  });
});

describe('browserTimezone', () => {
  it('returns a non-empty IANA-looking string', () => {
    const tz = browserTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
});

describe('resolveRawTimezone', () => {
  it('mirrors the sanitized resolver for valid inputs', () => {
    expect(resolveRawTimezone('utc', 'Asia/Tokyo', 'Europe/Berlin')).toBe('UTC');
    expect(resolveRawTimezone('user', 'Asia/Tokyo', 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveRawTimezone('vehicle', 'Asia/Tokyo', 'Europe/Berlin')).toBe('Asia/Tokyo');
    expect(resolveRawTimezone('vehicle', null, '')).toBe(browserTimezone());
  });

  it('propagates an invalid saved zone raw so conversion throws instead of guessing', () => {
    // Display (resolveTimezone) must fall back; conversion must NOT guess.
    expect(resolveTimezone('user', 'Asia/Tokyo', 'Invalid/Zone')).toBe(browserTimezone());
    expect(resolveRawTimezone('user', 'Asia/Tokyo', 'Invalid/Zone')).toBe('Invalid/Zone');
    expect(() => new Intl.DateTimeFormat('en-US', {
      timeZone: resolveRawTimezone('user', 'Asia/Tokyo', 'Invalid/Zone'),
    }).format(0)).toThrow(RangeError);
  });

  it('still prefers a valid vehicle zone over an invalid override', () => {
    expect(resolveRawTimezone('vehicle', 'Asia/Tokyo', 'Invalid/Zone')).toBe('Asia/Tokyo');
  });
});
