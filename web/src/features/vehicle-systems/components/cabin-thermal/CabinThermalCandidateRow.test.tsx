import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CandidateWindow } from '../../lib/cabinThermal';
import { CabinThermalCandidateRow } from './CabinThermalCandidateRow';

const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  zone: 'America/Los_Angeles',
  timeFormat: 'relative',
  zoneMode: 'vehicle',
  resolveZone: vi.fn(),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: preferences.locale,
    settings: {
      tz_display_default: preferences.zoneMode,
      time_format_default: preferences.timeFormat,
    },
  }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: (mode: string) => {
    preferences.resolveZone(mode);
    return preferences.zone;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? '')),
  }),
}));

const candidate: CandidateWindow = {
  id: 'window-1',
  index: 1,
  startTs: '2026-08-08T00:15:37.123Z',
  endTs: '2026-08-08T01:15:37.123Z',
  startMs: Date.parse('2026-08-08T00:15:37.123Z'),
  endMs: Date.parse('2026-08-08T01:15:37.123Z'),
  samples: 12,
  durationMin: 60,
  startInsideC: 40,
  endInsideC: 30,
  ambientC: 20,
  initialGapC: 20,
  direction: 'cooling',
  slopePerMin: -0.01,
  r2: 0.95,
  tauMin: 100,
  disposition: 'accepted',
  reason: null,
};

function row(value = candidate) {
  return <CabinThermalCandidateRow
    candidate={value}
    locale="en-US"
    temperatureUnit="°C"
    formatTemperature={temperature => `${temperature}°C`}
    formatDuration={seconds => `${seconds} s`}
  />;
}

describe('CabinThermalCandidateRow evidence timestamps', () => {
  beforeEach(() => {
    preferences.locale = 'en-US';
    preferences.zone = 'America/Los_Angeles';
    preferences.timeFormat = 'relative';
    preferences.zoneMode = 'vehicle';
    preferences.resolveZone.mockClear();
  });

  it.each(['relative', 'absolute'])('keeps full absolute evidence with saved %s display', timeFormat => {
    preferences.timeFormat = timeFormat;
    const { container } = render(row());
    const time = container.querySelector('time');
    expect(time).toHaveTextContent('Aug 7, 2026, 05:15 PM (America/Los_Angeles)');
    expect(time).toHaveAttribute('datetime', candidate.startTs);
    expect(time).toHaveAttribute('title', `${candidate.startTs} (America/Los_Angeles)`);
    expect(preferences.resolveZone).toHaveBeenCalledWith('vehicle');
    expect(screen.getByText('Accepted fit')).toBeInTheDocument();
    for (const value of ['Cooling', '12', '3600 s', '40°C / 20°C', '6000 s']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText('Initial gap')).toBeInTheDocument();
    expect(screen.getByText('Slope / R²')).toBeInTheDocument();
  });

  it('updates the effective zone and locale-derived clock without changing the source instant', () => {
    const view = render(row());
    preferences.locale = 'en-GB';
    preferences.zone = 'UTC';
    preferences.zoneMode = 'utc';
    view.rerender(row());
    const time = view.container.querySelector('time');
    expect(time).toHaveTextContent('8 Aug 2026, 00:15 (UTC)');
    expect(time).toHaveAttribute('datetime', candidate.startTs);
    expect(preferences.resolveZone).toHaveBeenCalledWith('utc');
  });

  it('preserves rejected populated candidates and missing fit placeholders', () => {
    render(row({ ...candidate, disposition: 'rejected', reason: 'insufficient_samples',
      slopePerMin: null, r2: null, tauMin: null }));
    expect(screen.getByText('Insufficient samples')).toBeInTheDocument();
    expect(screen.getByText('40°C / 20°C')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
