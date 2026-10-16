import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { DataProvenance, DataState } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { MapsOperationalBrief } from './MapsOperationalBrief';

const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  language: 'en',
  mode: 'vehicle' as 'vehicle' | 'user' | 'utc',
  userZone: 'America/Los_Angeles',
  vehicleZone: 'UTC',
  timezoneSpy: vi.fn(),
}));

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => ({
      locale: preferences.locale,
      settings: {
        locale: preferences.locale,
        tz_display_default: preferences.mode,
        unit_of_length: 'km',
        unit_of_temp: 'C',
        unit_of_pressure: 'bar',
        decimal_precision: 2,
        currency_symbol: '$',
      },
    }),
  };
});

vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return {
    ...actual,
    useTimezone: (mode: 'vehicle' | 'user' | 'utc') => {
      preferences.timezoneSpy(mode);
      return mode === 'utc' ? 'UTC' : mode === 'user' ? preferences.userZone : preferences.vehicleZone;
    },
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createInstance } = await import('i18next');
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: {} },
      de: { translation: {
        provenance: {
          live: 'Live-Daten', cached: 'Zwischengespeichert', historical: 'Historisch',
          inferred: 'Geschätzt', repaired: 'Korrigiert', unknown: 'Unbekannte Quelle',
        },
        mapsBrief: { freshness: {
          received: 'Empfangen {{time}} (keine Beobachtung oder letzter Besuch)',
          unknown: 'Empfangszeit unbekannt',
        } },
      } },
    },
  });
  return { ...actual, useTranslation: () => ({ t: i18n.getFixedT(preferences.language), i18n }) };
});

beforeEach(() => {
  preferences.locale = 'en-US';
  preferences.language = 'en';
  preferences.mode = 'vehicle';
  preferences.userZone = 'America/Los_Angeles';
  preferences.vehicleZone = 'UTC';
  preferences.timezoneSpy.mockClear();
});

afterEach(cleanup);

const scope = 'Vehicle 7 · latest 50 positions, not a complete route window';
const sourceLabel = 'Latest position';
const provenanceLabels: Record<DataProvenance, string> = {
  live: 'Live', cached: 'Cached', historical: 'Historical',
  inferred: 'Estimated', repaired: 'Repaired', unknown: 'Unknown source',
};
const state = deriveDataState({
  data: { speed: 0 },
  error: new Error('refresh failed'),
  dataUpdatedAt: Date.parse('2026-10-06T20:00:00Z'),
}, { provenance: 'live' });
const metrics = [
  { metricId: 'speed', occurrenceId: 'speed', rawValue: 0, label: 'Measured speed', description: 'Zero means measured stationary.', display: { formatter: (raw: number) => ({ value: `${raw.toFixed(2)} km/h`, unit: '' }) } },
  { metricId: 'number', occurrenceId: 'heading', rawValue: undefined, label: 'Heading', description: 'Heading is not reported.' },
  { metricId: 'count', occurrenceId: 'history-count', rawValue: 50, label: 'Loaded positions', description: scope, context: <a href="#/maps/navigation-route">Navigation route</a> },
] as const satisfies readonly StatMetric[];

function renderBrief(loading?: boolean, sources: readonly { label: string; state: DataState<unknown> }[] = [{ label: sourceLabel, state }], onRetry?: () => void, sourceMetrics: readonly StatMetric[] = metrics) {
  return render(
    <MemoryRouter>
      <MapsOperationalBrief title="Vehicle status" description="Independent position evidence"
        scope={scope} metrics={sourceMetrics} sources={sources} loading={loading} onRetry={onRetry} />
    </MemoryRouter>,
  );
}

describe('maps OperationalBrief source contract', () => {
  it('forwards embedded mode to the shared surface', () => {
    const { container } = render(<MemoryRouter><MapsOperationalBrief title="Vehicle status"
      description="Independent position evidence" scope={scope} metrics={metrics}
      sources={[{ label: sourceLabel, state }]} variant="embedded" /></MemoryRouter>);
    expect(container.querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief-surface="standalone"]')).toBeNull();
  });

  it('retains measured zero and missing heading with real source status and original bounds', () => {
    const { container } = renderBrief();
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(band).toHaveAttribute('data-operational-brief');
    expect(container.querySelector('[data-operational-metric="speed"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="heading"]')).toHaveAttribute('data-value-state', 'missing');
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    assertOperationalBriefDisclosure(band, 'Retained source data');
    expect(within(band).getAllByText(scope).length).toBeGreaterThan(0);
  });

  it('opens the real Review details drawer and retains rich context, links and numeric evidence', () => {
    renderBrief();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Vehicle status details' });
    expect(within(drawer).getByText('0.00 km/h')).toBeInTheDocument();
    expect(within(drawer).getByText('Heading is not reported.')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Navigation route' })).toHaveAttribute('href', '#/maps/navigation-route');
    expect(within(drawer).getAllByText(scope)).toHaveLength(2);
  });

  it('withholds values but retains metric labels and context on first loading', () => {
    const { container } = renderBrief(true);
    expect(screen.getByRole('region', { name: 'Vehicle status' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Measured speed')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
  });

  it('preserves raw SI measurements and validates them before invoking a specialist formatter', () => {
    const formatter = vi.fn((raw: number) => ({ value: raw.toFixed(4), unit: '°' }));
    const inputs: readonly StatMetric[] = [
      { metricId: 'number', rawValue: 0, label: 'Heading', display: { formatter } },
      { metricId: 'number', rawValue: Number.NaN, label: 'Invalid heading', display: { formatter } },
      { metricId: 'number', rawValue: null, label: 'Missing heading', display: { formatter } },
      { metricId: 'speed', rawValue: 25, label: 'SI speed' },
    ];
    const { result } = renderHook(() => useOperationalMetrics(inputs));
    expect(result.current.map(({ rawValue }) => rawValue)).toEqual([0, Number.NaN, null, 25]);
    expect(result.current.map(({ valueState }) => valueState)).toEqual(['value', 'invalid', 'missing', 'value']);
    expect(formatter).toHaveBeenCalledOnce();
    expect(formatter.mock.calls[0][0]).toBe(0);
  });

  it.each([
    ['no sources', [], 'Source data unavailable'],
    ['resolved empty', [{ label: sourceLabel, state: deriveDataState({ data: [] }, { unavailable: true }) }], 'Source data unavailable'],
    ['partial payload', [{ label: sourceLabel, state: deriveDataState({ data: { speed: 0 } }, { partial: true }) }], 'Independent sources incomplete'],
    ['first failure', [{ label: sourceLabel, state: deriveDataState({ error: new Error('first load failed') }) }], 'Source data unavailable'],
    ['paused without data', [{ label: sourceLabel, state: deriveDataState({ fetchStatus: 'paused' }) }], 'Source data unavailable'],
  ] as const)('does not fabricate availability or loading for %s', (_case, sources, statusLabel) => {
    const { container } = renderBrief(false, sources);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(within(band).getByText(statusLabel)).toBeInTheDocument();
    expect(band).not.toHaveAttribute('aria-busy');
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(screen.queryByText('Loading source data')).not.toBeInTheDocument();
  });

  it('shows initial loading from source status while preserving labels, scope and retry', () => {
    const onRetry = vi.fn();
    const { container } = renderBrief(true, [{ label: sourceLabel, state: deriveDataState({ isPending: true }) }], onRetry);
    expect(screen.getByText('Loading source data')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vehicle status' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Measured speed')).toBeInTheDocument();
    expect(screen.getAllByText(scope).length).toBeGreaterThan(0);
    expect(screen.getByText(`${sourceLabel}: Receipt time unknown`)).toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders unknown values rather than measured zero for an explicitly inactive initial source', () => {
    const inactiveState = deriveDataState({ isPending: true, fetchStatus: 'idle' });
    const unknownMetrics = metrics.map((metric) => ({ ...metric, rawValue: undefined }));
    const { container } = renderBrief(false, [{ label: sourceLabel, state: inactiveState }], undefined, unknownMetrics);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(band).not.toHaveAttribute('aria-busy');
    assertOperationalBriefDisclosure(band, 'Source data unavailable');
    expect(within(band).getByText('Measured speed')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(3);
    expect(container.querySelector('[data-operational-metric="speed"]')).toHaveAttribute('data-value-state', 'missing');
    expect(container.querySelector('[data-operational-metric="speed"] [data-operational-value]')).toHaveTextContent('—');
    expect(within(band).queryByText('0.00 km/h')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(band, 'Loading source data', { absent: true });
    fireEvent.click(within(band).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Vehicle status details' });
    expect(within(drawer).queryByText('0.00 km/h')).not.toBeInTheDocument();
    expect(within(drawer).getByText(`${sourceLabel}: Unknown source`)).toBeInTheDocument();
  });

  it('infers initial loading when the explicit activity flag is unspecified', () => {
    const { container } = renderBrief(undefined, [{ label: sourceLabel, state: deriveDataState({ isPending: true }) }]);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(band).toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(band, 'Loading source data');
    expect(within(band).getByText('Measured speed')).toBeInTheDocument();
    expect(within(band).getAllByText(scope).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    expect(container.querySelector('[data-operational-metric="speed"] span[aria-hidden="true"][class~="bg-[var(--surface-3)]"]')).toBeTruthy();
    expect(within(band).queryByText('0.00 km/h')).not.toBeInTheDocument();
  });

  it.each([
    ['failure', deriveDataState({ error: new Error('history failed') })],
    ['empty', deriveDataState({ data: [] }, { unavailable: true, provenance: 'historical' })],
    ['pending', deriveDataState({ isPending: true })],
  ] as const)('keeps independent metrics and prior receipts when another source is %s', (_case, otherState) => {
    renderBrief(false, [{ label: sourceLabel, state }, { label: 'Route history', state: otherState }]);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(within(band).getByText('Independent sources incomplete')).toBeInTheDocument();
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    const receipt = `${sourceLabel}: Received Oct 6, 2026, 08:00 PM (not observation or last visit)`;
    expect(within(band).getByText(receipt)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Vehicle status details' });
    expect(within(drawer).getByText(receipt)).toBeInTheDocument();
    expect(within(drawer).getByText(`${sourceLabel}: Cached; Route history: ${provenanceLabels[otherState.provenance]}`)).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Navigation route' })).toHaveAttribute('href', '#/maps/navigation-route');
  });

  it.each(['failed', 'paused', 'refreshing', 'healthy'] as const)('preserves retained measurements and provenance during %s refresh', (refresh) => {
    const retainedState = deriveDataState({
      data: { speed: 0 },
      dataUpdatedAt: Date.parse('2026-10-06T20:00:00Z'),
      ...(refresh === 'failed' ? { error: new Error('refresh failed') } : {}),
      ...(refresh === 'paused' ? { fetchStatus: 'paused' as const } : {}),
      ...(refresh === 'refreshing' ? { isFetching: true } : {}),
    }, { provenance: 'live' });
    renderBrief(false, [{ label: sourceLabel, state: retainedState }]);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(within(band).getByText(refresh === 'failed' || refresh === 'paused' ? 'Retained source data' : 'Source data available')).toBeInTheDocument();
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    expect(band).not.toHaveAttribute('aria-busy');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog', { name: 'Vehicle status details' })).getByText(`${sourceLabel}: ${provenanceLabels[retainedState.provenance]}`)).toBeInTheDocument();
  });

  it('reacts to saved locale and timezone across a day boundary in the band and open drawer', () => {
    const receivedAt = Date.parse('2026-01-01T00:30:00Z');
    const observationAt = '2025-12-20T10:00:00Z';
    const lastVisitAt = '2025-12-18T09:00:00Z';
    const sourceState = Object.freeze(deriveDataState({
      data: Object.freeze({ speed_mps: 0, observed_at: observationAt, last_visit_at: lastVisitAt }),
      dataUpdatedAt: receivedAt,
    }, { provenance: 'historical' }));
    const sources = Object.freeze([{ label: 'signal_log / locations:last_visit', state: sourceState }]);
    preferences.mode = 'user';
    const { rerender } = renderBrief(false, sources);
    const usReceipt = 'signal_log / locations:last_visit: Received Dec 31, 2025, 04:30 PM (not observation or last visit)';
    expect(within(screen.getByRole('region', { name: 'Vehicle status' })).getByText(usReceipt)).toBeInTheDocument();
    expect(preferences.timezoneSpy).toHaveBeenCalledWith('user');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog', { name: 'Vehicle status details' })).getByText(usReceipt)).toBeInTheDocument();

    preferences.locale = 'de-DE';
    preferences.language = 'de';
    preferences.mode = 'utc';
    rerender(
      <MemoryRouter>
        <MapsOperationalBrief title="Vehicle status" description="Independent position evidence"
          scope={scope} metrics={metrics} sources={sources} loading={false} />
      </MemoryRouter>,
    );
    const germanReceipt = 'signal_log / locations:last_visit: Empfangen 1. Jan. 2026, 00:30 (keine Beobachtung oder letzter Besuch)';
    expect(within(screen.getByRole('region', { name: 'Vehicle status' })).getByText(germanReceipt)).toBeInTheDocument();
    const drawer = screen.getByRole('dialog', { name: 'Vehicle status details' });
    expect(within(drawer).getByText(germanReceipt)).toBeInTheDocument();
    expect(within(drawer).queryByText(usReceipt)).not.toBeInTheDocument();
    expect(within(drawer).getByText('signal_log / locations:last_visit: Historisch')).toBeInTheDocument();
    expect(preferences.timezoneSpy).toHaveBeenCalledWith('utc');
    expect(sourceState.updatedAt).toBe(receivedAt);
    expect(sourceState.provenance).toBe('historical');
    expect(sourceState.data).toEqual({ speed_mps: 0, observed_at: observationAt, last_visit_at: lastVisitAt });
    expect(screen.queryByText(observationAt, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(lastVisitAt, { exact: false })).not.toBeInTheDocument();
  });

  it('uses the saved vehicle-zone mode without a browser-timezone override', () => {
    preferences.vehicleZone = 'Asia/Tokyo';
    const sourceState = deriveDataState({ data: { speed_mps: 0 }, dataUpdatedAt: Date.parse('2026-01-01T00:30:00Z') });
    renderBrief(false, [{ label: sourceLabel, state: sourceState }]);
    expect(screen.getByText(`${sourceLabel}: Received Jan 1, 2026, 09:30 AM (not observation or last visit)`)).toBeInTheDocument();
    expect(preferences.timezoneSpy).toHaveBeenCalledWith('vehicle');
  });

  it.each([
    ['live', 'Live-Daten'],
    ['cached', 'Zwischengespeichert'],
    ['historical', 'Historisch'],
    ['inferred', 'Geschätzt'],
    ['repaired', 'Korrigiert'],
    ['unknown', 'Unbekannte Quelle'],
  ] as const)('localizes %s provenance without changing raw source identities or SI values', (provenance, label) => {
    preferences.language = 'de';
    const rawLabel = 'signal_log / Position:last_seen';
    const sourceState = Object.freeze(deriveDataState({ data: Object.freeze({ speed_mps: 25 }) }, { provenance }));
    const rawMetrics = Object.freeze([{ metricId: 'speed', rawValue: 25, label: 'SI speed' }] as const);
    const { container } = renderBrief(false, [{ label: rawLabel, state: sourceState }], undefined, rawMetrics);
    const receipt = container.querySelector('[data-source-label]');
    expect(receipt).toHaveAttribute('data-source-label', rawLabel);
    expect(receipt).toHaveAttribute('data-provenance', provenance);
    expect(receipt).toHaveTextContent(`${rawLabel}: Empfangszeit unbekannt`);
    expect(screen.getByText('90.00 km/h')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog', { name: 'Vehicle status details' })).getByText(`${rawLabel}: ${label}`)).toBeInTheDocument();
    expect(sourceState.provenance).toBe(provenance);
    expect(sourceState.data?.speed_mps).toBe(25);
    expect(rawMetrics[0].rawValue).toBe(25);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1])('keeps an absent or invalid receipt %s explicitly unknown', (updatedAt) => {
    renderBrief(false, [{ label: sourceLabel, state: { ...state, updatedAt } }]);
    expect(screen.getByText(`${sourceLabel}: Receipt time unknown`)).toBeInTheDocument();
    expect(screen.getByText('Retained source data')).toBeInTheDocument();
    expect(screen.getByText('0.00 km/h')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog', { name: 'Vehicle status details' })).getByText(`${sourceLabel}: Receipt time unknown`)).toBeInTheDocument();
  });
});
