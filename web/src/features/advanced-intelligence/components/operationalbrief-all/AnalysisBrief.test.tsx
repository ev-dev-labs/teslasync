import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import type { ReactNode } from 'react';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { DataStateSource } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useRetainedMutation } from '@/hooks/useRetainedMutation';
import type { DataQuality, Evidence } from '@/types/advancedIntelligence';
import { formatEfficiencyFromSI } from '../../formatters';
import { AnalysisBrief } from './AnalysisBrief';
import en from '@/i18n/en.json';
import { getFormatterPreferences, setGlobalLocale } from '@/lib/numberFormat';

vi.unmock('react-i18next');
const translations = createInstance();
let savedLocale = getFormatterPreferences().locale;

beforeEach(async () => {
  savedLocale = getFormatterPreferences().locale;
  setGlobalLocale('en-US');
  await translations.use(initReactI18next).init({
    lng: 'en', fallbackLng: false, interpolation: { escapeValue: false },
    resources: { en: { translation: en } },
  });
});

afterEach(() => {
  setGlobalLocale(savedLocale);
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
    },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={translations}><MemoryRouter>{children}</MemoryRouter></I18nextProvider>;
}

const retainedEvidence: Evidence = {
  source: 'sensor',
  summary: 'Recorded evidence.',
  observed_at: null,
  sample_count: null,
};

const emptyQuality: DataQuality = {
  status: 'limited',
  sample_count: 0,
  coverage_pct: null,
  window_start: null,
  window_end: null,
  reasons: [],
};

const metrics: readonly StatMetric[] = [
  { occurrenceId: 'zero-energy', metricId: 'energy', rawValue: 0, label: 'Usable battery', description: 'Returned battery energy.' },
  { occurrenceId: 'missing-energy', metricId: 'energy', rawValue: null, label: 'Energy required', description: 'Unsupported energy is not zero.' },
  { occurrenceId: 'invalid-percent', metricId: 'percent', rawValue: Number.NaN, label: 'Readiness', description: 'Returned readiness percentage.' },
  { occurrenceId: 'horizon', metricId: 'duration', rawValue: 7200, label: 'Survival horizon', description: 'Modeled duration.' },
  { occurrenceId: 'epsilon', metricId: 'ratio', rawValue: 0.25, label: 'Epsilon', description: 'Dimensionless privacy spend.' },
  { occurrenceId: 'efficiency', metricId: 'efficiency', rawValue: 0.15, label: 'Efficiency', description: 'Calibrated Wh/m.',
    display: { formatter: (raw, preferences) => ({
      value: formatEfficiencyFromSI(raw, preferences.units), unit: '',
    }) } },
];

describe('advanced intelligence raw OperationalBrief bridge', () => {
  it('retains numeric raw SI/epsilon values, distinguishes invalid and missing from zero and preserves specialist efficiency display', () => {
    const { result } = renderHook(() => useOperationalMetrics(metrics), { wrapper: Wrapper });
    expect(result.current.map(metric => metric.rawValue)).toEqual([0, null, Number.NaN, 7200, 0.25, 0.15]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'missing', 'invalid', 'value', 'value', 'value']);
    expect(result.current[0].value).toBe('0.00 kWh');
    expect(result.current[1].value).toBe('—');
    expect(result.current[2].value).toBe('—');
    expect(result.current[3].value).toBe('2.00 h');
    expect(result.current[4].value).toBe('0.25');
    expect(result.current[5].value).toBe(formatEfficiencyFromSI(0.15, {
      distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
    }));
    expect(metrics[3].rawValue).toBe(7200);
  });

  it('validates each count without coercing unknown, fractional or negative samples into a count', () => {
    const counts: readonly StatMetric[] = [
      { metricId: 'count', occurrenceId: 'zero', rawValue: 0 },
      { metricId: 'count', occurrenceId: 'unknown', rawValue: undefined },
      { metricId: 'count', occurrenceId: 'fractional', rawValue: 1.5 },
      { metricId: 'count', occurrenceId: 'negative', rawValue: -1 },
    ];
    const { result } = renderHook(() => useOperationalMetrics(counts), { wrapper: Wrapper });
    expect(result.current.map(metric => metric.rawValue)).toEqual([0, undefined, 1.5, -1]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'missing', 'invalid', 'invalid']);
  });

  it('keeps actual bridge markers and the built-in drawer with ordered evidence and unscored confidence', async () => {
    const user = userEvent.setup();
    render(<AnalysisBrief
      id="analysis-brief-contract"
      title="Modeled source summary"
      description="Supported source values only."
      emptyMessage="Submit a scenario."
      metrics={metrics}
      vehicleId={7}
      hasResult
      quality={{
        status: 'limited', sample_count: 0, coverage_pct: null,
        window_start: '2026-08-01T00:00:00Z', window_end: '2026-08-03T00:00:00Z',
        reasons: ['Coverage is incomplete.'],
      }}
      generatedAt="2026-08-04T00:00:00Z"
      evidence={[
        { source: 'first-source', summary: 'First evidence.', sample_count: 0, observed_at: null },
        { source: 'second-source', summary: 'Second evidence.', sample_count: null, observed_at: '2026-08-02T00:00:00Z' },
      ]}
      limitations={['No physical actuation.']}
      provenance="Modeled local source"
    />, { wrapper: Wrapper });
    const brief = screen.getByTestId('analysis-brief-contract');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(brief.querySelector('[data-operational-metric="zero-energy"]')).toHaveAttribute('data-value-state', 'value');
    assertOperationalMetricUnavailable(brief, 'Energy required');
    assertOperationalMetricUnavailable(brief, 'Readiness');
    const reviewDetails = within(brief).getByRole('button', { name: 'Review details' });
    await user.click(reviewDetails);
    const drawer = screen.getByRole('dialog', { name: 'Modeled source summary details' });
    expect(within(drawer).getByText('2 empty fields are hidden.')).toBeInTheDocument();
    expect(within(drawer).getAllByRole('button', { name: 'Close' })[0]).toHaveFocus();
    expect(within(drawer).getByText('First evidence. · 0 samples')).toBeInTheDocument();
    expect(within(drawer).getByText('Second evidence.')).toBeInTheDocument();
    expect(within(drawer).getAllByText('No physical actuation.')).toHaveLength(2);
    expect(within(drawer).getByText('Coverage is incomplete.')).toBeInTheDocument();
    expect(within(drawer).getByText('Source coverage not supplied')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reviewDetails).toHaveFocus();
  });

  const baseProps = {
    id: 'analysis-state', title: 'Assessment', description: 'Source-backed assessment.',
    emptyMessage: 'Submit a scenario.', metrics, vehicleId: 7, hasResult: false,
    provenance: 'Modeled source',
  };

  it.each([
    { count: 0, label: '0 samples' },
    { count: 1, label: '1 sample' },
    { count: 12345, label: '12,345 samples' },
    { count: -12345, label: '-12,345 samples' },
    { count: -1, label: '-1 sample' },
    { count: 1.25, label: '1 samples' },
    { count: -1.75, label: '-2 samples' },
  ])('formats evidence count $count without changing its plural category or raw data', ({ count, label }) => {
    const item = Object.freeze({ ...retainedEvidence, sample_count: count });
    render(<AnalysisBrief {...baseProps} hasResult evidence={[item]}
      quality={{ ...emptyQuality, sample_count: count }} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Assessment details' }));
    expect(drawer.getByText(`Recorded evidence. · ${label}`)).toBeInTheDocument();
    expect(drawer.getByText(`Source quality sample count: ${label.split(' ')[0]}`)).toBeInTheDocument();
    expect(item.sample_count).toBe(count);
  });

  it.each([
    { kind: 'missing', count: undefined },
    { kind: 'null', count: null },
    { kind: 'NaN', count: Number.NaN },
    { kind: 'positive infinity', count: Number.POSITIVE_INFINITY },
    { kind: 'negative infinity', count: Number.NEGATIVE_INFINITY },
    { kind: 'numeric string', count: '0' },
    { kind: 'empty string', count: '' },
    { kind: 'boolean', count: false },
  ])('keeps $kind evidence and quality counts distinct from measured zero', ({ count }) => {
    const item: Evidence = { ...retainedEvidence };
    const quality: DataQuality = { ...emptyQuality };
    Object.defineProperty(item, 'sample_count', { value: count });
    Object.defineProperty(quality, 'sample_count', { value: count });
    Object.freeze(item);
    Object.freeze(quality);
    render(<AnalysisBrief {...baseProps} hasResult evidence={[item]}
      quality={quality} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Assessment details' }));
    expect(drawer.getByText('Recorded evidence.')).toBeInTheDocument();
    expect(drawer.getByText('Source quality sample count: —')).toBeInTheDocument();
    expect(drawer.queryByText('Recorded evidence. · 0 samples')).not.toBeInTheDocument();
    expect(item.sample_count).toBe(count);
  });

  it('uses the existing numeric locale preference for evidence count display', () => {
    setGlobalLocale('de-DE');
    render(<AnalysisBrief {...baseProps} hasResult
      evidence={[{ ...retainedEvidence, sample_count: 12345 }]} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByText('Recorded evidence. · 12.345 samples')).toBeInTheDocument();
  });

  it('keeps never-submitted idle sources Not calculated with the submission instruction and every metric', () => {
    render(<AnalysisBrief {...baseProps} query={{ fetchStatus: 'idle' }} />, { wrapper: Wrapper });
    const brief = screen.getByTestId('analysis-state');
    expect(within(brief).getAllByText('Not calculated')).toHaveLength(1);
    assertOperationalBriefDisclosure(brief, 'Not calculated');
    expect(within(brief).getByText('Submit a scenario.')).toBeInTheDocument();
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
  });

  it('shows first active work as busy but a first paused request as attention, never endless loading', () => {
    const retry = vi.fn();
    const { rerender } = render(<AnalysisBrief {...baseProps} pending query={{
      isLoading: true, isFetching: true, fetchStatus: 'fetching', refetch: retry,
    }} />, { wrapper: Wrapper });
    expect(screen.getByTestId('analysis-state')).toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(screen.getByTestId('analysis-state'), 'Awaiting result');
    rerender(<AnalysisBrief {...baseProps} pending query={{
      isLoading: true, isPending: true, fetchStatus: 'paused', refetch: retry,
    }} />);
    const brief = screen.getByTestId('analysis-state');
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(within(brief).getAllByText('The initial evidence query is paused; no empty result is inferred.')).toHaveLength(2);
    assertOperationalBriefDisclosure(brief, 'The initial evidence query is paused; no empty result is inferred.');
    expect(screen.queryByText('Awaiting result')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'refreshing', query: { data: {}, isFetching: true, fetchStatus: 'fetching' }, label: 'Updating result' },
    { name: 'paused', query: { data: {}, isLoading: true, fetchStatus: 'paused' }, label: 'Retained result' },
    { name: 'failed', query: { data: {}, error: new Error('Refresh failed') }, label: 'Retained result' },
  ] satisfies Array<{ name: string; query: DataStateSource<unknown>; label: string }>)(
    'retains results and drawer values during $name without automatic retry', ({ query, label }) => {
      const retry = vi.fn();
      render(<AnalysisBrief {...baseProps} hasResult query={{ ...query, refetch: retry }}
        limitations={['Source limitation.']} evidence={[retainedEvidence]}
      />, { wrapper: Wrapper });
      const brief = screen.getByTestId('analysis-state');
      expect(brief).not.toHaveAttribute('aria-busy');
      assertOperationalBriefDisclosure(brief, label);
      expect(within(brief).getByText('0.00 kWh')).toBeInTheDocument();
      expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(4);
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog', { name: 'Assessment details' });
      expect(within(drawer).getByText('0.00 kWh')).toBeInTheDocument();
      expect(within(drawer).getByText('Recorded evidence.')).toBeInTheDocument();
      expect(within(drawer).getAllByText('Source limitation.')).toHaveLength(2);
      expect(retry).not.toHaveBeenCalled();
    },
  );

  it('keeps first failure separate from a successful empty response and quality-limited evidence', () => {
    const { rerender } = render(<AnalysisBrief {...baseProps} query={{
      error: new Error('Initial failure'), isError: true,
    }} />, { wrapper: Wrapper });
    assertOperationalBriefDisclosure(document.body, 'Source unavailable');
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-state')).not.toHaveAttribute('aria-busy');
    rerender(<AnalysisBrief {...baseProps} hasResult metrics={[]} query={{ data: [], isSuccess: true }}
      quality={emptyQuality} />);
    assertOperationalBriefDisclosure(screen.getByTestId('analysis-state'), 'Limited evidence');
    expect(screen.queryByText('Not calculated')).not.toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
  });

  it('wraps the retained-result retry with mobile targets and desktop restoration, then recovers without losing zero', () => {
    const retry = vi.fn();
    const { rerender } = render(<AnalysisBrief {...baseProps} hasResult query={{
      data: {}, error: new Error('Refresh failed'), refetch: retry,
    }} />, { wrapper: Wrapper });
    const action = screen.getByRole('button', { name: 'Retry' });
    expect(action).toHaveClass('h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0', 'whitespace-normal', 'max-w-full');
    expect(action.querySelector('span')).toHaveClass('min-w-0', 'break-words');
    fireEvent.click(action);
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    rerender(<AnalysisBrief {...baseProps} hasResult query={{
      data: {}, isFetching: true, fetchStatus: 'fetching', refetch: retry,
    }} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(screen.getByTestId('analysis-state'), 'Updating result');
    rerender(<AnalysisBrief {...baseProps} hasResult query={{
      data: {}, isSuccess: true, fetchStatus: 'idle', refetch: retry,
    }} />);
    expect(screen.queryByText('Retained result')).not.toBeInTheDocument();
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('honors the real publication scope guard instead of retaining obsolete vehicle metrics', () => {
    const data = { vehicle_id: 7, energy_wh: 0 };
    const variables = { vehicle_id: 7 };
    const scope = {
      data: (value: typeof data) => value.vehicle_id,
      inputs: (value: typeof variables) => value.vehicle_id,
    };
    function ScopedBrief({ vehicleId }: { vehicleId: number | null }) {
      const publication = useRetainedMutation({
        data, variables, isPending: false, error: null,
      }, vehicleId, scope);
      return <AnalysisBrief {...baseProps} vehicleId={vehicleId}
        hasResult={publication.result != null} query={publication.source}
        metrics={[{ occurrenceId: 'scoped-energy', metricId: 'energy',
          rawValue: publication.result?.energy_wh, label: 'Scoped energy' }]} />;
    }
    const { rerender } = render(<ScopedBrief vehicleId={7} />, { wrapper: Wrapper });
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    rerender(<ScopedBrief vehicleId={8} />);
    expect(screen.queryByText('0.00 kWh')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not calculated')).toHaveLength(1);
    assertOperationalBriefDisclosure(screen.getByTestId('analysis-state'), 'Not calculated');
    rerender(<ScopedBrief vehicleId={7} />);
    expect(screen.queryByText('0.00 kWh')).not.toBeInTheDocument();
    rerender(<ScopedBrief vehicleId={null} />);
    expect(screen.getAllByText('Select a vehicle to load intelligence.')).toHaveLength(2);
    assertOperationalBriefDisclosure(screen.getByTestId('analysis-state'), 'Select a vehicle to load intelligence.');
    expect(screen.getByTestId('analysis-state')).not.toHaveAttribute('aria-busy');
  });
});
