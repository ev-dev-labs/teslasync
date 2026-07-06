import { describe, it, expect } from 'vitest';

import { parseUserAgent, describeDevice, type ParsedDevice } from './deviceLabel';

// Real-world user-agent strings, one representative per branch. Kept as named
// constants so the intent of each assertion is legible and precedence cases
// (e.g. Edge/Opera/Chromium all carrying "Chrome/") are obvious.
const UA = {
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  operaWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0',
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  chromiumLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/120.0.0.0 Chrome/120.0.0.0 Safari/537.36',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  safariIpod:
    'Mozilla/5.0 (iPod touch; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  // OS token but no browser token → drives the "os only" fallback.
  bareWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  // Browser token but no OS token → drives the "browser only" fallback.
  bareFirefox: 'Mozilla/5.0 Firefox/121.0',
  // Nothing recognisable at all.
  unknown: 'SomeHeadlessCrawler/2.1 (+https://example.com/bot)',
} as const;

describe('parseUserAgent', () => {
  describe('empty / missing input', () => {
    it.each<[string, string | null | undefined]>([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace only', '   \t\n '],
    ])('returns { browser: null, os: null } for %s', (_label, input) => {
      expect(parseUserAgent(input)).toEqual({ browser: null, os: null });
    });
  });

  describe('browser detection', () => {
    it.each<[string, string]>([
      ['Edge', UA.edgeWin],
      ['Opera', UA.operaWin],
      ['Chrome', UA.chromeWin],
      ['Chromium', UA.chromiumLinux],
      ['Firefox', UA.firefoxWin],
      ['Safari', UA.safariMac],
    ])('identifies %s', (expected, ua) => {
      expect(parseUserAgent(ua).browser).toBe(expected);
    });
  });

  describe('browser precedence (all Chromium-based UAs carry "Chrome/")', () => {
    it('prefers Edge over the embedded Chrome token', () => {
      expect(parseUserAgent(UA.edgeWin).browser).toBe('Edge');
    });

    it('prefers Opera over the embedded Chrome token', () => {
      expect(parseUserAgent(UA.operaWin).browser).toBe('Opera');
    });

    it('does not misreport Chromium as Chrome', () => {
      expect(parseUserAgent(UA.chromiumLinux).browser).toBe('Chromium');
    });

    it('does not misreport Chrome (which also carries "Safari/") as Safari', () => {
      expect(parseUserAgent(UA.chromeMac).browser).toBe('Chrome');
    });
  });

  describe('os detection', () => {
    it.each<[string, string]>([
      ['Windows', UA.chromeWin],
      ['macOS', UA.chromeMac],
      ['Android', UA.chromeAndroid],
      ['iOS', UA.safariIphone],
      ['Linux', UA.chromiumLinux],
    ])('identifies %s', (expected, ua) => {
      expect(parseUserAgent(ua).os).toBe(expected);
    });
  });

  describe('os precedence — Apple mobile carries the "like Mac OS X" token', () => {
    it.each<[string, string]>([
      ['iPhone', UA.safariIphone],
      ['iPad', UA.safariIpad],
      ['iPod', UA.safariIpod],
    ])('classifies %s as iOS, never macOS', (_label, ua) => {
      const parsed = parseUserAgent(ua);
      expect(parsed.os).toBe('iOS');
      expect(parsed.os).not.toBe('macOS');
    });

    it('still classifies genuine Macintosh as macOS', () => {
      expect(parseUserAgent(UA.chromeMac).os).toBe('macOS');
      expect(parseUserAgent(UA.safariMac).os).toBe('macOS');
    });

    it('classifies Android (which also carries "Linux") as Android, never Linux', () => {
      const parsed = parseUserAgent(UA.chromeAndroid);
      expect(parsed.os).toBe('Android');
      expect(parsed.os).not.toBe('Linux');
    });
  });

  it('returns both fields null for an unrecognised agent', () => {
    expect(parseUserAgent(UA.unknown)).toEqual({ browser: null, os: null });
  });

  it('returns a fully-shaped ParsedDevice object', () => {
    const parsed: ParsedDevice = parseUserAgent(UA.firefoxAndroid);
    expect(parsed).toEqual({ browser: 'Firefox', os: 'Android' });
    expect(Object.keys(parsed).sort()).toEqual(['browser', 'os']);
  });
});

describe('describeDevice', () => {
  it('joins browser and os with a middot separator', () => {
    const label = describeDevice(UA.chromeMac);
    expect(label).toBe('Chrome \u00b7 macOS');
    expect(label).toContain('\u00b7');
  });

  it('falls back to the browser alone when the os is unknown', () => {
    expect(describeDevice(UA.bareFirefox)).toBe('Firefox');
  });

  it('falls back to the os alone when the browser is unknown', () => {
    expect(describeDevice(UA.bareWindows)).toBe('Windows');
  });

  it.each<[string, string | null | undefined]>([
    ['unrecognised agent', UA.unknown],
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('renders an em-dash for %s', (_label, input) => {
    expect(describeDevice(input)).toBe('\u2014');
  });

  it('produces the correct label across representative devices', () => {
    expect(describeDevice(UA.edgeWin)).toBe('Edge \u00b7 Windows');
    expect(describeDevice(UA.safariIphone)).toBe('Safari \u00b7 iOS');
    expect(describeDevice(UA.firefoxAndroid)).toBe('Firefox \u00b7 Android');
    expect(describeDevice(UA.chromiumLinux)).toBe('Chromium \u00b7 Linux');
  });
});
