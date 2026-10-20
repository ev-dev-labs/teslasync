import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NotificationLog } from '@/api/types';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { NotificationInboxDetails } from './NotificationInboxDetails';

const original = getFormatterPreferences();
afterEach(() => {
  setGlobalLocale(original.locale);
  setGlobalPrecision(original.precision);
});

describe('notification delivery latency preserves integer milliseconds', () => {
  it.each([
    { locale: 'en-US', raw: 1250, expected: '1,250 ms' },
    { locale: 'de-DE', raw: 1250, expected: '1.250 ms' },
    { locale: 'en-US', raw: 0, expected: '0 ms' },
    { locale: 'de-DE', raw: 0, expected: '0 ms' },
    { locale: 'en-US', raw: null, expected: '—' },
    { locale: 'de-DE', raw: null, expected: '—' },
    { locale: 'en-US', raw: undefined, expected: '—' },
    { locale: 'de-DE', raw: undefined, expected: '—' },
  ])('renders $raw in $locale without adding fractional precision or inventing zero', ({ locale, raw, expected }) => {
    setGlobalLocale(locale);
    setGlobalPrecision(4);
    const log = Object.freeze({
      id: 1, channel_id: 1, title: 'Recorded delivery', message: 'Recorded message',
      status: 'sent', created_at: '2026-10-16T12:00:00Z', latency_ms: raw,
    }) as NotificationLog;
    render(<NotificationInboxDetails log={log} />);
    const field = screen.getByText('Delivery latency', { selector: 'dt' });
    expect(field.nextElementSibling?.tagName).toBe('DD');
    expect(field.nextElementSibling?.textContent).toBe(expected);
    expect(log.latency_ms).toBe(raw);
  });
});
