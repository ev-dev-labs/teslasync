/**
 * JourneySequence tells the drive in order — Start, the leg (distance and
 * duration), then Destination — with each endpoint's place, time and battery,
 * using the same place / coordinate / timezone rules as the journey table.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import type { DriveDetail } from '@/types/driving';
import { formatDateTime } from '@/lib/dateFormat';

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicle: () => ({ data: { timezone: 'America/New_York' } }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { locale: 'en-US', timezone_user: 'Asia/Tokyo', tz_display_default: 'vehicle', decimal_precision: 2 },
    locale: 'en-US',
    decimals: 2,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { JourneySequence } from './JourneySequence';

const START_TS = '2026-07-04T18:30:00.000Z';
const END_TS = '2026-07-04T19:15:00.000Z';

function makeDrive(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 42, vehicleId: 7, startTs: START_TS, endTs: END_TS, durationS: 2700, distanceM: 42000,
    startAddress: '1 Main St, San Francisco', endAddress: '500 Center Rd, Palo Alto',
    startLat: 37.7749, startLon: -122.4194, endLat: 37.4419, endLon: -122.143,
    startBatteryPct: 90, endBatteryPct: 72, energyUsedWh: 9800, regenEnergyWh: 1200,
    avgSpeedMps: 15.5, maxSpeedMps: 33.3, avgPowerW: 14000, outsideTempAvgC: 21, insideTempAvgC: 22,
    score: 88, endedStatus: 'parked', createdAt: START_TS, updatedAt: END_TS, positions: [], telemetry: [],
    ...overrides,
  };
}

const show = (overrides: Partial<DriveDetail> = {}) =>
  render(<JourneySequence drive={makeDrive(overrides)} distance="42.0 km" duration="45 min" />);
const endpoint = (id: 'start' | 'destination') =>
  document.querySelector<HTMLElement>(`[data-journey-endpoint="${id}"]`)!;

describe('JourneySequence', () => {
  it('tells the journey in order: start, the leg, then destination', () => {
    show();
    const list = screen.getByRole('list', { name: 'Drive timeline' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('data-journey-endpoint', 'start');
    expect(items[1]).toHaveAttribute('data-journey-leg');
    expect(items[2]).toHaveAttribute('data-journey-endpoint', 'destination');
    expect(items[1]).toHaveTextContent('Distance: 42.0 km · Duration: 45 min');
  });

  it('shows each endpoint’s place, time in the resolved timezone and battery', () => {
    show();
    expect(within(endpoint('start')).getByText('1 Main St, San Francisco')).toBeInTheDocument();
    expect(within(endpoint('start')).getByText('Battery 90.00%')).toBeInTheDocument();
    expect(within(endpoint('start')).getByText(formatDateTime(START_TS, { tz: 'America/New_York', locale: 'en-US' }))).toHaveAttribute('dateTime', START_TS);
    expect(within(endpoint('destination')).getByText('500 Center Rd, Palo Alto')).toBeInTheDocument();
    expect(within(endpoint('destination')).getByText('Battery 72.00%')).toBeInTheDocument();
  });

  it('falls back to coordinates, then a no-address label, and keeps missing battery unknown', () => {
    show({ startAddress: null, endAddress: null, endLat: null, endLon: null, endBatteryPct: null });
    expect(within(endpoint('start')).getByText('37.77°N, 122.42°W')).toBeInTheDocument();
    expect(within(endpoint('destination')).getByText('No address data')).toBeInTheDocument();
    expect(within(endpoint('destination')).getByText('Battery —')).toBeInTheDocument();
  });

  it('marks an ongoing drive’s destination as in progress', () => {
    show({ endTs: null, endAddress: null, endLat: null, endLon: null });
    // Both the place and the time read "In progress"; no end time is invented.
    expect(within(endpoint('destination')).getByText('In progress')).toBeInTheDocument();
    expect(endpoint('destination').textContent).toMatch(/In progress.*In progress · Battery 72\.00%/);
    expect(endpoint('destination').querySelector('time')).toBeNull();
  });
});
