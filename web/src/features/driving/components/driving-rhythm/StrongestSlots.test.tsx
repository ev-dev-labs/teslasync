import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getFormatterPreferences,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';
import { buildDrivingRhythm } from '../../lib/drivingRhythm';
import { StrongestSlots } from './StrongestSlots';

const { formatDistance } = vi.hoisted(() => ({
  formatDistance: vi.fn((value: number | null) =>
    value === null ? '—' : `${value} m`,
  ),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

const originalPreferences = getFormatterPreferences();
const state = {
  isLoading: false,
  retained: false,
  error: null,
  onRetry: vi.fn(),
};

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  formatDistance.mockClear();
});

afterEach(() => {
  cleanup();
  setGlobalLocale(originalPreferences.locale);
  setGlobalPrecision(originalPreferences.precision);
});

function populatedSummary() {
  return {
    ...buildDrivingRhythm([], { timeZone: 'UTC' }),
    minSlotDrives: 2000,
    strongestSlots: [
      {
        day: 1, hour: 8, rank: 1, count: 2345, share: 0.625,
        distanceM: 4321, measuredDistanceDrives: 1234, qualified: true,
      },
      {
        day: 2, hour: 9, rank: 2, count: 1000, share: 0.375,
        distanceM: 999, measuredDistanceDrives: 0, qualified: false,
      },
    ],
  };
}

describe('StrongestSlots integer display formatting', () => {
  it('formats populated counts without decimals and preserves slot evidence and raw operands', () => {
    const summary = populatedSummary();
    const original = structuredClone(summary);
    render(<StrongestSlots summary={summary} state={state} />);

    const region = screen.getByRole('region', { name: 'Strongest departure time slots' });
    const rows = within(region).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('#1');
    expect(rows[0]).toHaveTextContent('Mon at 08:00');
    expect(rows[0]).toHaveTextContent('2,345');
    expect(rows[0]).toHaveTextContent('62.50% of valid starts');
    expect(rows[0]).toHaveTextContent('4321 m logged across 1,234 measured drives');
    expect(rows[0]).toHaveTextContent('sample supported');
    expect(rows[1]).toHaveTextContent('#2');
    expect(rows[1]).toHaveTextContent('Tue at 09:00');
    expect(rows[1]).toHaveTextContent('1,000');
    expect(rows[1]).toHaveTextContent('— logged across 0 measured drives');
    expect(rows[1]).toHaveTextContent('below 2,000-drive floor');
    expect(formatDistance).toHaveBeenCalledWith(4321);
    expect(formatDistance).toHaveBeenCalledWith(null);
    expect(summary).toEqual(original);
  });

  it('updates visible and semantic list counts when locale changes without changing precision policy', () => {
    render(<StrongestSlots summary={populatedSummary()} state={state} />);
    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(3);
    });

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('2.345');
    expect(rows[0]).toHaveTextContent('1.234 measured drives');
    expect(rows[0]).toHaveTextContent('62,500% of valid starts');
    expect(rows[1]).toHaveTextContent('1.000');
    expect(rows[1]).toHaveTextContent('below 2.000-drive floor');
    expect(rows[0]).not.toHaveTextContent('2.345,000');
  });

  it('retains the empty panel without fabricating occupied slots', () => {
    render(
      <StrongestSlots
        summary={buildDrivingRhythm([], { timeZone: 'UTC' })}
        state={state}
      />,
    );
    expect(screen.getByRole('region')).toHaveTextContent(
      'No occupied weekday-hour slots are available to rank.',
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(formatDistance).not.toHaveBeenCalled();
  });
});
