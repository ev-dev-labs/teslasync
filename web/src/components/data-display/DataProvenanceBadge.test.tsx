import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { FormatOptions } from '@/lib/dateFormat';

import { DataProvenanceBadge } from './DataProvenanceBadge';

const { formatDateTime, preferences, readSettings, readVehicle } = vi.hoisted(() => ({
  formatDateTime: vi.fn((_value: Date, _options?: FormatOptions): string | undefined => undefined),
  readSettings: vi.fn(),
  readVehicle: vi.fn(),
  preferences: {
    locale: 'de-DE',
    settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
  },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => {
    readSettings();
    return preferences;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => {
    readVehicle();
    return { vehicle: { timezone: 'Asia/Tokyo' } };
  },
}));

vi.unmock('@/lib/timezone');

vi.mock('@/hooks/useDateFormat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDateFormat')>();
  return {
    useDateFormat: () => {
      const saved = actual.useDateFormat();
      return {
        ...saved,
        formatDateTime: (value: Date, options?: FormatOptions) =>
          formatDateTime(value, options) ?? saved.formatDateTime(value, options),
      };
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: { time?: string }) =>
      options?.time ? fallback.replace('{{time}}', options.time) : fallback,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

describe('DataProvenanceBadge', () => {
  beforeEach(() => {
    formatDateTime.mockReset();
    formatDateTime.mockReturnValue('14/11/2023, 22:13 UTC');
    readSettings.mockClear();
    readVehicle.mockClear();
    preferences.locale = 'de-DE';
    preferences.settings.tz_display_default = 'user';
    preferences.settings.timezone_user = 'America/Los_Angeles';
  });

  it('labels every provenance distinctly', () => {
    const cases = [
      ['live', 'Live'],
      ['cached', 'Cached'],
      ['historical', 'Historical'],
      ['inferred', 'Estimated'],
      ['repaired', 'Repaired'],
      ['unknown', 'Unknown source'],
    ] as const;

    for (const [provenance, label] of cases) {
      const { unmount } = render(<DataProvenanceBadge provenance={provenance} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
    expect(readSettings).not.toHaveBeenCalled();
    expect(readVehicle).not.toHaveBeenCalled();
  });

  it('never claims an unknown-origin value is live', () => {
    render(<DataProvenanceBadge provenance="unknown" />);
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText('Unknown source')).toBeInTheDocument();
  });

  it('marks an estimate as an estimate rather than a measurement', () => {
    render(<DataProvenanceBadge provenance="inferred" />);
    const badge = screen.getByLabelText('Estimated');
    expect(badge).toHaveAttribute('data-provenance', 'inferred');
    expect(badge.getAttribute('title')).toMatch(/did not report this value directly/i);
  });

  it('exposes provenance and status as separate data attributes', () => {
    render(<DataProvenanceBadge provenance="live" status="stale" />);
    const badge = screen.getByLabelText('Live');
    // Provenance is NOT rewritten by a degraded status — only toned down.
    expect(badge).toHaveAttribute('data-provenance', 'live');
    expect(badge).toHaveAttribute('data-data-status', 'stale');
    expect(badge).toHaveClass('text-[var(--text-secondary)]');
  });

  it.each(['partial', 'unavailable'] as const)('keeps live provenance neutral when %s', (status) => {
    render(<DataProvenanceBadge provenance="live" status={status} />);
    const badge = screen.getByLabelText('Live');
    expect(badge).toHaveAttribute('data-provenance', 'live');
    expect(badge).toHaveAttribute('data-data-status', status);
    expect(badge).toHaveClass('text-[var(--text-secondary)]');
  });

  it('defaults the status attribute to ok when none is supplied', () => {
    render(<DataProvenanceBadge provenance="historical" />);
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'ok');
  });

  it('appends the snapshot time when the capture instant is known', () => {
    render(<DataProvenanceBadge provenance="cached" updatedAt={1_700_000_000_000} />);
    expect(screen.getByLabelText('Cached').getAttribute('title')).toMatch(/Last updated/);
  });

  it('uses the current date preference without changing fetch or observation identity', () => {
    const fetchedAt = 1_700_000_000_000;
    const content = () => (
      <>
        <DataProvenanceBadge provenance="cached" status="stale" updatedAt={fetchedAt} />
        <span>Last real observation 2 hours ago</span>
      </>
    );
    const { rerender } = render(content());
    const badge = screen.getByLabelText('Cached');
    expect(badge).toHaveAttribute(
      'title',
      'Loaded earlier and retained. Not confirmed against the server since. Last updated: 14/11/2023, 22:13 UTC (America/Los_Angeles)',
    );
    expect(formatDateTime).toHaveBeenLastCalledWith(new Date(fetchedAt), { clock: { second: '2-digit' } });

    formatDateTime.mockReturnValue('11/14/2023, 2:13 PM PST');
    rerender(content());
    expect(badge).toHaveAttribute(
      'title',
      'Loaded earlier and retained. Not confirmed against the server since. Last updated: 11/14/2023, 2:13 PM PST (America/Los_Angeles)',
    );
    expect(formatDateTime).toHaveBeenLastCalledWith(new Date(fetchedAt), { clock: { second: '2-digit' } });
    expect(badge).toHaveAttribute('data-provenance', 'cached');
    expect(badge).toHaveAttribute('data-data-status', 'stale');
    expect(badge.getAttribute('title')).not.toMatch(/observation|signal time/i);
    expect(screen.getByText('Last real observation 2 hours ago')).toBeInTheDocument();
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, 8.64e15 + 1])(
    'omits an unknown or invalid update epoch (%s)',
    (updatedAt) => {
      render(<DataProvenanceBadge provenance="cached" updatedAt={updatedAt} />);
      expect(screen.getByLabelText('Cached').getAttribute('title')).not.toMatch(/Last updated/);
      expect(formatDateTime).not.toHaveBeenCalled();
      expect(readSettings).not.toHaveBeenCalled();
      expect(readVehicle).not.toHaveBeenCalled();
    },
  );

  it('uses saved locale and timezone across day boundaries without changing the request instant', () => {
    formatDateTime.mockReset();
    const fetchedAt = Date.parse('2024-01-01T00:30:17Z');
    const content = () => (
      <DataProvenanceBadge provenance="cached" status="partial" updatedAt={fetchedAt} />
    );
    const { rerender } = render(content());
    const badge = screen.getByLabelText('Cached');
    expect(badge).toHaveAttribute(
      'title',
      'Loaded earlier and retained. Not confirmed against the server since. Last updated: 31. Dez. 2023, 16:30:17 (America/Los_Angeles)',
    );
    expect(formatDateTime).toHaveBeenLastCalledWith(new Date(fetchedAt), { clock: { second: '2-digit' } });

    preferences.locale = 'ja-JP';
    preferences.settings.timezone_user = 'Asia/Tokyo';
    rerender(content());
    expect(badge).toHaveAttribute(
      'title',
      'Loaded earlier and retained. Not confirmed against the server since. Last updated: 2024年1月1日 09:30:17 (Asia/Tokyo)',
    );
    expect(formatDateTime).toHaveBeenLastCalledWith(new Date(fetchedAt), { clock: { second: '2-digit' } });
    expect(badge).toHaveAttribute('data-provenance', 'cached');
    expect(badge).toHaveAttribute('data-data-status', 'partial');
  });

  it('omits the snapshot time rather than inventing "now" when unknown', () => {
    render(<DataProvenanceBadge provenance="cached" updatedAt={null} />);
    expect(screen.getByLabelText('Cached').getAttribute('title')).not.toMatch(/Last updated/);
  });

  it('updates locale clock notation and discloses the resolved vehicle zone', () => {
    formatDateTime.mockReset();
    preferences.locale = 'en-US';
    preferences.settings.tz_display_default = 'vehicle';
    const instant = Date.parse('2024-01-01T00:30:00Z');
    const { rerender } = render(<DataProvenanceBadge provenance="historical" updatedAt={instant} />);
    expect(screen.getByLabelText('Historical')).toHaveAttribute(
      'title', expect.stringContaining('09:30:00 AM (Asia/Tokyo)'),
    );
    preferences.locale = 'en-GB';
    rerender(<DataProvenanceBadge provenance="historical" updatedAt={instant} />);
    expect(screen.getByLabelText('Historical')).toHaveAttribute(
      'title', expect.stringContaining('09:30:00 (Asia/Tokyo)'),
    );
    expect(formatDateTime).toHaveBeenLastCalledWith(new Date(instant), { clock: { second: '2-digit' } });
  });

  it.each([0, -1])('preserves the valid epoch %s with second precision', (updatedAt) => {
    formatDateTime.mockReset();
    preferences.settings.tz_display_default = 'utc';
    render(<DataProvenanceBadge provenance="historical" updatedAt={updatedAt} />);
    expect(screen.getByLabelText('Historical')).toHaveAttribute(
      'title',
      expect.stringContaining(updatedAt === 0
        ? '1. Jan. 1970, 00:00:00 (UTC)'
        : '31. Dez. 1969, 23:59:59 (UTC)'),
    );
    expect(formatDateTime).toHaveBeenLastCalledWith(new Date(updatedAt), { clock: { second: '2-digit' } });
  });

  it('preserves native span attributes and events without subscribing untimed public badges', () => {
    const onClick = vi.fn();
    render(<DataProvenanceBadge provenance="historical" id="public-source" onClick={onClick} iconOnly />);
    const badge = screen.getByLabelText('Historical');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveAttribute('id', 'public-source');
    expect(badge).toHaveAttribute('title', 'Read from stored history rather than current state.');
    expect(badge.querySelector('svg')).toBeNull();
    badge.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(readSettings).not.toHaveBeenCalled();
    expect(readVehicle).not.toHaveBeenCalled();
  });

  it('falls back to the unknown config for an out-of-union value', () => {
    // Provenance often arrives from an API string; a value outside the union
    // must fail closed to "unknown", never to "live".
    render(<DataProvenanceBadge provenance={'bogus' as never} />);
    expect(screen.getByText('Unknown source')).toBeInTheDocument();
  });
});
