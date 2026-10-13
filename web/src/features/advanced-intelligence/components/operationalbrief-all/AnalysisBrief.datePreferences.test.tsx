import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalBrief } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { DataQuality, Evidence } from '@/types/advancedIntelligence';
import { AnalysisBrief } from './AnalysisBrief';

const preferences = vi.hoisted(() => ({
  locale: 'en-GB',
  settings: { tz_display_default: 'utc' as 'utc' | 'user' | 'vehicle', timezone_user: 'Asia/Tokyo' },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => preferences,
}));
vi.unmock('@/lib/timezone');
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { id: 7, timezone: 'Europe/Berlin' } }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
    },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/components/data-display', async () => {
  const actual = await vi.importActual<typeof import('@/components/data-display')>('@/components/data-display');
  return {
    ...actual,
    OperationalBrief: vi.fn((props: ComponentProps<typeof actual.OperationalBrief>) => <actual.OperationalBrief {...props} />),
  };
});

const START = '2026-01-15T00:30:00Z';
const END = '2026-01-16T12:45:00Z';
const quality: DataQuality = {
  status: 'limited', sample_count: 0, coverage_pct: null,
  window_start: START, window_end: END, reasons: ['Synthetic coverage limitation.'],
};
const evidence: Evidence[] = [
  { source: 'synthetic-source', summary: 'Recorded synthetic evidence.', sample_count: 0, observed_at: START },
  { source: 'undated-source', summary: 'Undated synthetic evidence.', sample_count: null, observed_at: null },
];
const props: ComponentProps<typeof AnalysisBrief> = {
  id: 'date-preference-brief', title: 'Synthetic assessment', description: 'Supported observations only.',
  emptyMessage: 'Submit a synthetic scenario.', vehicleId: 7, hasResult: true,
  metrics: [
    { occurrenceId: 'zero-energy', metricId: 'energy', rawValue: 0, label: 'Measured energy' },
    { occurrenceId: 'unknown-energy', metricId: 'energy', rawValue: null, label: 'Unknown energy' },
  ],
  quality, evidence, generatedAt: START,
  limitations: ['No physical actuation.'], provenance: 'Synthetic modeled source',
};

beforeEach(() => {
  preferences.locale = 'en-GB';
  preferences.settings.tz_display_default = 'utc';
  preferences.settings.timezone_user = 'Asia/Tokyo';
  vi.mocked(OperationalBrief).mockClear();
});
afterEach(cleanup);

describe('AnalysisBrief date preferences', () => {
  it('renders window scope confidence basis and generation in saved locale and UTC instead of browser defaults', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(Intl.DateTimeFormat().resolvedOptions().locale).toBe('en-US');
    render(<AnalysisBrief {...props} />);
    const brief = screen.getByTestId('date-preference-brief');
    expect(within(brief).getByText('Vehicle #7 · Observation window: 15 Jan 2026, 00:30 – 16 Jan 2026, 12:45')).toBeVisible();
    expect(within(brief).getByText('Result generated: 15 Jan 2026, 00:30')).toBeVisible();
    expect(within(brief).getByText('Limited evidence')).toBeVisible();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText('Vehicle #7 · Observation window: 15 Jan 2026, 00:30 – 16 Jan 2026, 12:45')).toBeInTheDocument();
    expect(within(drawer).getByText('Result generated: 15 Jan 2026, 00:30')).toBeInTheDocument();
    expect(within(drawer).getByText('Observation window: 15 Jan 2026, 00:30 – 16 Jan 2026, 12:45')).toBeInTheDocument();
    expect(within(drawer).getByText('Source quality sample count: 0')).toBeInTheDocument();
    expect(within(drawer).getByText('Source coverage not supplied')).toBeInTheDocument();
    expect(within(drawer).getByText('Synthetic coverage limitation.')).toBeInTheDocument();
    expect(within(drawer).getByText('Recorded synthetic evidence. · 0 samples')).toBeInTheDocument();
    expect(within(drawer).getAllByText('No physical actuation.')).toHaveLength(2);
    expect(within(drawer).getByText('Synthetic modeled source')).toBeInTheDocument();
  });

  it('reacts to locale user timezone and timezone mode changes while retained evidence and retry remain available', () => {
    const retry = vi.fn();
    const retainedProps = { ...props, query: { data: {}, error: new Error('Synthetic refresh failure'), refetch: retry } };
    const { rerender } = render(<AnalysisBrief {...retainedProps} />);
    const brief = screen.getByTestId('date-preference-brief');
    expect(within(brief).getByText('Retained result')).toBeVisible();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeVisible();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));

    preferences.locale = 'de-DE';
    rerender(<AnalysisBrief {...retainedProps} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: 15. Jan. 2026, 00:30 – 16. Jan. 2026, 12:45')).toBeVisible();
    expect(within(brief).getByText('Result generated: 15. Jan. 2026, 00:30')).toBeVisible();
    expect(screen.getByText('Observation window: 15. Jan. 2026, 00:30 – 16. Jan. 2026, 12:45')).toBeInTheDocument();

    preferences.settings.tz_display_default = 'user';
    rerender(<AnalysisBrief {...retainedProps} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: 15. Jan. 2026, 09:30 – 16. Jan. 2026, 21:45')).toBeVisible();
    expect(within(brief).getByText('Result generated: 15. Jan. 2026, 09:30')).toBeVisible();
    expect(screen.getByText('Observation window: 15. Jan. 2026, 09:30 – 16. Jan. 2026, 21:45')).toBeInTheDocument();

    preferences.settings.timezone_user = 'America/Los_Angeles';
    rerender(<AnalysisBrief {...retainedProps} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: 14. Jan. 2026, 16:30 – 16. Jan. 2026, 04:45')).toBeVisible();
    expect(within(brief).getByText('Result generated: 14. Jan. 2026, 16:30')).toBeVisible();
    expect(screen.getByText('Observation window: 14. Jan. 2026, 16:30 – 16. Jan. 2026, 04:45')).toBeInTheDocument();

    preferences.settings.tz_display_default = 'vehicle';
    rerender(<AnalysisBrief {...retainedProps} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: 15. Jan. 2026, 01:30 – 16. Jan. 2026, 13:45')).toBeVisible();
    expect(within(brief).getByText('Result generated: 15. Jan. 2026, 01:30')).toBeVisible();
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText('Vehicle #7 · Observation window: 15. Jan. 2026, 01:30 – 16. Jan. 2026, 13:45')).toBeInTheDocument();
    expect(within(drawer).getByText('Result generated: 15. Jan. 2026, 01:30')).toBeInTheDocument();
    expect(within(drawer).getByText('Observation window: 15. Jan. 2026, 01:30 – 16. Jan. 2026, 13:45')).toBeInTheDocument();
    expect(within(drawer).getByText('Recorded synthetic evidence. · 0 samples')).toBeInTheDocument();
    expect(within(drawer).getByText('Synthetic modeled source')).toBeInTheDocument();
    expect(within(drawer).getByText('Synthetic coverage limitation.')).toBeInTheDocument();
    expect(within(drawer).getAllByText('No physical actuation.')).toHaveLength(2);
    expect(within(brief).getByText('0.00 kWh')).toBeVisible();
    expect(within(brief).getByText('Retained result')).toBeVisible();
    expect(brief).not.toHaveAttribute('aria-busy');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(quality.window_start).toBe(START);
    expect(quality.window_end).toBe(END);
    expect(props.generatedAt).toBe(START);
  });

  it('matches the parent preference formatter for generation and both window endpoints at the same instant', () => {
    function ParentDisplay() {
      const { formatDateTime } = useDateFormat();
      return <>
        <Text as="p">{`Departure: ${formatDateTime(START)}`}</Text>
        <AnalysisBrief {...props} quality={{ ...quality, window_end: START }} />
      </>;
    }
    render(<ParentDisplay />);
    expect(screen.getByText('Departure: 15 Jan 2026, 00:30')).toBeVisible();
    const brief = screen.getByTestId('date-preference-brief');
    expect(within(brief).getByText('Vehicle #7 · Observation window: 15 Jan 2026, 00:30 – 15 Jan 2026, 00:30')).toBeVisible();
    expect(within(brief).getByText('Result generated: 15 Jan 2026, 00:30')).toBeVisible();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText('Result generated: 15 Jan 2026, 00:30')).toBeInTheDocument();
    expect(within(drawer).getByText('Vehicle #7 · Observation window: 15 Jan 2026, 00:30 – 15 Jan 2026, 00:30')).toBeInTheDocument();
    expect(within(drawer).getByText('Observation window: 15 Jan 2026, 00:30 – 15 Jan 2026, 00:30')).toBeInTheDocument();
  });

  it('preserves partial and missing windows and absent generation without hiding the brief or review action', () => {
    const { rerender } = render(<AnalysisBrief {...props} generatedAt={null} quality={{ ...quality, window_end: null }} />);
    const brief = screen.getByTestId('date-preference-brief');
    expect(within(brief).getByText('Vehicle #7 · Observation window: 15 Jan 2026, 00:30 – —')).toBeVisible();
    expect(within(brief).getByText('Result generation time not supplied')).toBeVisible();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText('Observation window: 15 Jan 2026, 00:30 – —')).toBeInTheDocument();
    rerender(<AnalysisBrief {...props} generatedAt={undefined} quality={{ ...quality, window_start: null }} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: — – 16 Jan 2026, 12:45')).toBeVisible();
    expect(within(brief).getByText('Result generation time not supplied')).toBeVisible();
    expect(within(drawer).getByText('Observation window: — – 16 Jan 2026, 12:45')).toBeInTheDocument();
    rerender(<AnalysisBrief {...props} generatedAt="" quality={{ ...quality, window_start: null, window_end: null }} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window not supplied')).toBeVisible();
    expect(within(brief).getByText('Result generation time not supplied')).toBeVisible();
    expect(within(drawer).getByText('Observation window not supplied')).toBeInTheDocument();
    expect(within(drawer).getByText('Result generation time not supplied')).toBeInTheDocument();
    rerender(<AnalysisBrief {...props} generatedAt="not-an-iso-instant" />);
    expect(within(brief).getByText('Result generated: —')).toBeVisible();
    expect(within(drawer).getByText('Result generated: —')).toBeInTheDocument();
  });

  it('preserves unknown quality missing metric and absent evidence placeholders in the details', () => {
    const { rerender } = render(<AnalysisBrief {...props} quality={null} evidence={null} limitations={null} generatedAt={null} />);
    const brief = screen.getByTestId('date-preference-brief');
    expect(within(brief).getByText('Quality not supplied')).toBeVisible();
    expect(within(brief).getByText('0.00 kWh')).toBeVisible();
    expect(within(brief).getByText('—')).toBeVisible();
    expect(brief.querySelector('[data-operational-metric="unknown-energy"]')).toHaveAttribute('data-value-state', 'missing');
    expect(within(brief).getByText('Vehicle #7 · Observation window not supplied')).toBeVisible();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText('No supporting records were supplied.')).toBeInTheDocument();
    expect(within(drawer).getByText('No additional limitations were supplied.')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getByText('Synthetic modeled source')).toBeInTheDocument();
    rerender(<AnalysisBrief {...props} quality={undefined} evidence={[]} limitations={[]} generatedAt={undefined} />);
    expect(within(brief).getByText('Quality not supplied')).toBeVisible();
    expect(within(drawer).getByText('No supporting records were supplied.')).toBeInTheDocument();
  });

  it('forwards unchanged ISO evidence instants and provenance to the existing brief', () => {
    render(<AnalysisBrief {...props} />);
    const calls = vi.mocked(OperationalBrief).mock.calls;
    const lastProps = calls[calls.length - 1][0];
    expect(lastProps.narrative?.evidence).toEqual([
      {
        id: 'synthetic-source-0', summary: 'Recorded synthetic evidence. · 0 samples',
        observedAt: '2026-01-15T00:30:00Z', provenance: { source: 'synthetic-source' },
      },
      {
        id: 'undated-source-1', summary: 'Undated synthetic evidence.',
        observedAt: null, provenance: { source: 'undated-source' },
      },
    ]);
    expect(lastProps.narrative?.provenance).toEqual([{ source: 'Synthetic modeled source' }]);
    expect(lastProps.narrative?.limitations).toEqual(['No physical actuation.']);
    expect(lastProps.narrative?.confidence).toEqual({
      label: 'not_scored', score: null,
      basis: [
        'Limited evidence', 'Observation window: 15 Jan 2026, 00:30 – 16 Jan 2026, 12:45',
        'Source quality sample count: 0', 'Source coverage not supplied', 'Synthetic coverage limitation.',
      ],
    });
    expect(screen.getByRole('button', { name: 'Review details' })).toBeVisible();
  });
});
