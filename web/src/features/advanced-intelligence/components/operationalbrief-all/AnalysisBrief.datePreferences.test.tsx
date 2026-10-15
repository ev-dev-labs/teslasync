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
const selection = vi.hoisted(() => ({
  vehicle: { id: 7, timezone: 'Europe/Berlin' } as { id: number; timezone: string } | null,
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => preferences,
}));
vi.unmock('@/lib/timezone');
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selection,
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
  selection.vehicle = { id: 7, timezone: 'Europe/Berlin' };
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

  it.each([
    { locale: 'en-US', start: 'Jan 15, 2026, 12:30 AM', end: 'Jan 16, 2026, 12:45 PM' },
    { locale: 'en-GB', start: '15 Jan 2026, 00:30', end: '16 Jan 2026, 12:45' },
    { locale: 'fr-FR', start: '15 janv. 2026, 00:30', end: '16 janv. 2026, 12:45' },
    { locale: 'ja-JP', start: '2026年1月15日 00:30', end: '2026年1月16日 12:45' },
  ])('updates real date order and 12/24-hour presentation for saved $locale in the retained summary and open review', ({ locale, start, end }) => {
    const retry = vi.fn();
    const retainedProps = { ...props, query: { data: {}, error: new Error('Synthetic refresh failure'), refetch: retry } };
    const { rerender } = render(<AnalysisBrief {...retainedProps} />);
    const brief = screen.getByTestId('date-preference-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    preferences.locale = locale;
    rerender(<AnalysisBrief {...retainedProps} />);
    expect(within(brief).getByText(`Vehicle #7 · Observation window: ${start} – ${end}`)).toBeVisible();
    expect(within(brief).getByText(`Result generated: ${start}`)).toBeVisible();
    expect(within(brief).getByText('Retained result')).toBeVisible();
    expect(within(brief).getByText('0.00 kWh')).toBeVisible();
    expect(within(brief).getByText('—')).toBeVisible();
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText(`Vehicle #7 · Observation window: ${start} – ${end}`)).toBeInTheDocument();
    expect(within(drawer).getByText(`Observation window: ${start} – ${end}`)).toBeInTheDocument();
    expect(within(drawer).getByText(`Result generated: ${start}`)).toBeInTheDocument();
    expect(within(drawer).getByText('Recorded synthetic evidence. · 0 samples')).toBeInTheDocument();
    expect(within(drawer).getByText('Synthetic modeled source')).toBeInTheDocument();
    expect(within(drawer).getAllByText('No physical actuation.')).toHaveLength(2);
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(props.generatedAt).toBe(START);
    expect(quality.window_start).toBe(START);
    expect(quality.window_end).toBe(END);
  });

  it('reacts to selected vehicle timezone changes and missing vehicle fallback in all direct brief date roles', () => {
    preferences.settings.tz_display_default = 'vehicle';
    const { rerender } = render(<AnalysisBrief {...props} />);
    const brief = screen.getByTestId('date-preference-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    selection.vehicle = { id: 8, timezone: 'America/Los_Angeles' };
    rerender(<AnalysisBrief {...props} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: 14 Jan 2026, 16:30 – 16 Jan 2026, 04:45')).toBeVisible();
    expect(within(brief).getByText('Result generated: 14 Jan 2026, 16:30')).toBeVisible();
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText('Observation window: 14 Jan 2026, 16:30 – 16 Jan 2026, 04:45')).toBeInTheDocument();
    selection.vehicle = null;
    rerender(<AnalysisBrief {...props} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: 15 Jan 2026, 09:30 – 16 Jan 2026, 21:45')).toBeVisible();
    expect(within(brief).getByText('Result generated: 15 Jan 2026, 09:30')).toBeVisible();
    expect(within(drawer).getByText('Observation window: 15 Jan 2026, 09:30 – 16 Jan 2026, 21:45')).toBeInTheDocument();
    expect(props.vehicleId).toBe(7);
    expect(props.generatedAt).toBe(START);
  });

  it('preserves distinct raw multi-source dates through DST preference changes and leaves invalid windows unknown', () => {
    preferences.settings.tz_display_default = 'user';
    preferences.settings.timezone_user = 'America/Los_Angeles';
    const beforeGap = '2026-03-08T09:30:00Z';
    const afterGap = '2026-03-08T10:30:00Z';
    const gapQuality = Object.freeze({ ...quality, window_start: beforeGap, window_end: afterGap });
    const sourceEvidence = [
      Object.freeze({ source: 'before-gap', summary: 'First distinct observation.', sample_count: 0, observed_at: beforeGap }),
      Object.freeze({ source: 'after-gap', summary: 'Second distinct observation.', sample_count: null, observed_at: afterGap }),
      Object.freeze({ source: 'invalid-source', summary: 'Invalid source observation.', sample_count: null, observed_at: 'invalid-date' }),
      Object.freeze({ source: 'missing-source', summary: 'Missing source observation.', sample_count: null, observed_at: null }),
    ];
    const gapProps = { ...props, quality: gapQuality, evidence: sourceEvidence, generatedAt: afterGap };
    const { rerender } = render(<AnalysisBrief {...gapProps} />);
    const brief = screen.getByTestId('date-preference-brief');
    expect(within(brief).getByText('Vehicle #7 · Observation window: 8 Mar 2026, 01:30 – 8 Mar 2026, 03:30')).toBeVisible();
    expect(within(brief).getByText('Result generated: 8 Mar 2026, 03:30')).toBeVisible();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    preferences.settings.tz_display_default = 'utc';
    rerender(<AnalysisBrief {...gapProps} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: 8 Mar 2026, 09:30 – 8 Mar 2026, 10:30')).toBeVisible();
    expect(within(brief).getByText('Result generated: 8 Mar 2026, 10:30')).toBeVisible();
    const drawer = screen.getByRole('dialog', { name: 'Synthetic assessment details' });
    expect(within(drawer).getByText('Observation window: 8 Mar 2026, 09:30 – 8 Mar 2026, 10:30')).toBeInTheDocument();
    expect(within(drawer).getByText('First distinct observation. · 0 samples')).toBeInTheDocument();
    expect(within(drawer).getByText('Second distinct observation.')).toBeInTheDocument();
    expect(within(drawer).getByText('Invalid source observation.')).toBeInTheDocument();
    expect(within(drawer).getByText('Missing source observation.')).toBeInTheDocument();
    const calls = vi.mocked(OperationalBrief).mock.calls;
    expect(calls[calls.length - 1][0].narrative?.evidence?.map(item => item.observedAt)).toEqual([
      beforeGap, afterGap, 'invalid-date', null,
    ]);
    expect(sourceEvidence.map(item => item.observed_at)).toEqual([beforeGap, afterGap, 'invalid-date', null]);
    expect(gapQuality.window_start).toBe(beforeGap);
    expect(gapQuality.window_end).toBe(afterGap);
    rerender(<AnalysisBrief {...gapProps} quality={{ ...quality, window_start: 'invalid-window', window_end: '' }} />);
    expect(within(brief).getByText('Vehicle #7 · Observation window: — – —')).toBeVisible();
    expect(within(drawer).getByText('Observation window: — – —')).toBeInTheDocument();
    expect(within(brief).getByRole('button', { name: 'Review details' })).toBeVisible();
  });
});
