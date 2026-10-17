import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { analyzeShareCard, type ShareCardWindowInput } from '../../lib/shareCard';
import { ShareCardCoverageDisclosure } from './ShareCardCoverageDisclosure';
import type { ShareCardDisplay, ShareCardQueryState } from './types';

const preferences = vi.hoisted(() => ({
  locale: 'de-DE',
  settings: { tz_display_default: 'user', timezone_user: 'Asia/Tokyo' },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => preferences,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));

const window: ShareCardWindowInput = {
  startLabel: '2026-03-07',
  endLabel: '2026-03-08',
  startInstant: '2026-03-07T08:00:00.000Z',
  endInstantExclusive: '2026-03-09T07:00:00.000Z',
  timezone: 'America/Los_Angeles',
};

const state: ShareCardQueryState = {
  enabled: true,
  hasData: true,
  isInitialLoading: false,
  isInitialPaused: false,
  initialError: null,
  isResolved: true,
  isRefreshing: false,
  cachedRefreshError: null,
  cachedRefreshPaused: false,
  onRetry: vi.fn(),
};

const display: ShareCardDisplay = {
  distanceUnit: 'km',
  durationUnit: 'h',
  energyUnit: 'kWh',
  formatNumber: (value) => String(value),
  formatDistance: vi.fn(),
  formatDuration: (value) => `${value} s`,
  formatEnergy: vi.fn(),
  formatSpeed: vi.fn(),
  formatTemperature: vi.fn(),
  formatEfficiency: vi.fn(),
  formatPercent: vi.fn(),
  formatMonth: vi.fn(),
  distanceValue: (value) => value,
  durationValue: (value) => value,
  energyValue: (value) => value,
};

function evidenceCell(label: string) {
  const row = screen.getByRole('rowheader', { name: label }).closest('tr');
  if (!row) throw new Error(`Missing evidence row: ${label}`);
  return within(row).getByRole('cell');
}

describe('ShareCardCoverageDisclosure date preferences', () => {
  it('uses the saved locale and analysis timezone across midnight and DST without changing source scope', () => {
    const analysis = analyzeShareCard([
      { id: 1, start_ts: '2026-03-08T07:59:00.000Z' },
      { id: 2, start_ts: '2026-03-08T10:01:00.000Z' },
    ], window);
    const original = structuredClone(analysis);

    render(<ShareCardCoverageDisclosure analysis={analysis} state={state} display={display} />);

    expect(evidenceCell('Earliest evidence')).toHaveTextContent('7. März 2026, 23:59');
    expect(evidenceCell('Latest evidence')).toHaveTextContent('8. März 2026, 03:01');
    expect(evidenceCell('Active/requested days')).toHaveTextContent('2 / 2');
    expect(analysis).toEqual(original);
    expect(analysis.window).toMatchObject(window);
    expect(analysis.earliestEvidence).toBe('2026-03-08T07:59:00.000Z');
    expect(analysis.latestEvidence).toBe('2026-03-08T10:01:00.000Z');
  });

  it('retains UTC analysis instants instead of applying the saved Tokyo timezone', () => {
    const analysis = analyzeShareCard([
      { id: 1, start_ts: '2026-03-08T23:59:00.000Z' },
      { id: 2, start_ts: '2026-03-09T00:01:00.000Z' },
    ], {
      ...window,
      startLabel: '2026-03-08',
      endLabel: '2026-03-09',
      startInstant: '2026-03-08T00:00:00.000Z',
      endInstantExclusive: '2026-03-10T00:00:00.000Z',
      timezone: 'UTC',
    });

    render(<ShareCardCoverageDisclosure analysis={analysis} state={state} display={display} />);

    expect(evidenceCell('Earliest evidence')).toHaveTextContent('8. März 2026, 23:59');
    expect(evidenceCell('Latest evidence')).toHaveTextContent('9. März 2026, 00:01');
  });

  it.each([null, undefined, '', 'not-a-date'])('shows placeholders for %s evidence while retaining the disclosure', (value) => {
    const analysis = analyzeShareCard([], window);
    const { container } = render(
      <ShareCardCoverageDisclosure
        analysis={{ ...analysis, earliestEvidence: value ?? null, latestEvidence: value ?? null }}
        state={state}
        display={display}
      />,
    );

    expect(evidenceCell('Earliest evidence')).toHaveTextContent('—');
    expect(evidenceCell('Latest evidence')).toHaveTextContent('—');
    expect(screen.getByTestId('share-card-coverage-disclosure')).toBeInTheDocument();
    expect(evidenceCell('Active/requested days')).toHaveTextContent('0 / 2');
    expect(container).not.toHaveTextContent('Invalid Date');
  });
});
