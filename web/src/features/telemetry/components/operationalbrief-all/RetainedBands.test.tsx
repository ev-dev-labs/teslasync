import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportAgreementResponse } from '@/api/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import './metricPreferencesTestSetup';
import { LiveMonitorKpiBand } from '../LiveMonitorKpiBand';
import { LiveSignalTail } from '../LiveSignalTail';
import { SignalLogKpiBand } from '../SignalLogKpiBand';
import { SignalGapKpis } from '../SignalGapKpis';
import { TransportAgreementMetrics } from '../TransportAgreementMetrics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: unknown, variables?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(variables?.[name] ?? `{{${name}}}`));
  },
  i18n: { language: 'en' },
}) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function review(testId: string) {
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button', { name: 'Review details' }));
  return screen.getByRole('dialog');
}

describe('Retained telemetry bands and actual Review drawer', () => {
  it('retains the disconnected tail, fractional raw rate, capacity and type denominators', () => {
    render(<LiveMonitorKpiBand connected={false} rate={1.234567} bufferCount={50}
      bufferMax={200} uniqueSignals={17} numericCount={33} categoricalCount={17} />);
    expect(screen.getByTestId('live-monitor-summary')).toHaveTextContent('Retained source data');
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual(['Disconnected', 1.234567, 50, 17, 33, 17]);
    const drawer = review('live-monitor-summary');
    expect(drawer).toHaveTextContent('SSE transport connection only');
    expect(drawer).toHaveTextContent('/ 200');
    expect(drawer).toHaveTextContent('Boolean and string entries');
    expect(drawer).toHaveTextContent('Current bounded SSE tail buffer only');
  });

  it('keeps a frozen tail, its raw precision, filter, table and actions across drawer review', () => {
    const pause = vi.fn(); const clear = vi.fn();
    render(<MemoryRouter><LiveSignalTail paused entries={[
      { id: 1, timestamp: '2026-01-01T00:00:00Z', name: 'BatteryLevel', value: '80.123456', type: 'number' },
      { id: 2, timestamp: '2026-01-01T00:00:01Z', name: 'CabinTemperature', value: '21.456789 °C', type: 'number' },
    ]} rate={0.1234567} bufferMax={500} onPauseToggle={pause} onClear={clear} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Filter signals'), { target: { value: 'BATTERY' } });
    const brief = screen.getByTestId('live-tail-summary');
    expect(brief).toHaveTextContent('Tail paused');
    expect(brief.querySelector('[data-operational-metric="rate"] [data-operational-value]')).toHaveTextContent('0.1234567');
    expect(brief.querySelector('[data-operational-metric="filtered"] [data-operational-value]')).toHaveTextContent('1');
    expect(screen.getByText('80.123456')).toBeInTheDocument();
    expect(screen.queryByText('21.456789 °C')).not.toBeInTheDocument();
    const drawer = review('live-tail-summary');
    expect(drawer).toHaveTextContent('not durable telemetry ingestion');
    expect(drawer).toHaveTextContent('case-insensitive signal-name filter');
    expect(screen.getByLabelText('Filter signals')).toHaveValue('BATTERY');
    expect(screen.getByRole('button', { name: 'Resume', hidden: true })).toHaveAttribute('aria-pressed', 'true');
    expect(pause).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('keeps submitted history bounds separate from the retained observed span and server totals', () => {
    render(<SignalLogKpiBand loading retained hasQueried
      scope="2026-01-01T00:00:00Z → 2026-01-05T00:00:00Z"
      summary={{ totalRecords: 1250, signalsSelected: 3, distinctSignals: 2,
        numericPoints: 1000, textPoints: 200, boolPoints: 50,
        earliest: '2026-01-02T00:00:00Z', latest: '2026-01-02T01:30:00Z' }} />);
    const brief = screen.getByTestId('signal-log-summary');
    expect(brief).not.toHaveAttribute('aria-busy', 'true');
    expect(brief).toHaveTextContent('Retained source data');
    expect(brief).toHaveTextContent('2026-01-05T00:00:00Z');
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual([1250, 3, 1000, 200, 50, 5400]);
    const drawer = review('signal-log-summary');
    expect(drawer).toHaveTextContent('1h 30m');
    expect(drawer).toHaveTextContent('2 with data');
    expect(drawer).toHaveTextContent('not a server-wide total');
    expect(drawer).toHaveTextContent('not the requested range');
  });

  it('retains the actual freshness percentage and original age buckets without inventing a health score', () => {
    render(<SignalGapKpis hasVehicle retained
      buckets={{ total: 42, active: 30, aging: 8, stale: 3, never: 1 }} freshnessPct={87} />);
    const drawer = review('signal-gap-summary');
    expect(drawer).toHaveTextContent('Active (<30s)');
    expect(drawer).toHaveTextContent('Aging (<5min)');
    expect(drawer).toHaveTextContent('Stale (>5min)');
    expect(drawer).toHaveTextContent('87%');
    expect(drawer).toHaveTextContent('never-received signals remain in the denominator');
    expect(drawer).toHaveTextContent('sleeping vehicle can be stale without being unhealthy');
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual([42, 30, 8, 3, 1, 87]);
  });

  it('keeps retained producer-time agreement unknown when overlap is absent, with measured zero counts intact', () => {
    const evidence: TransportAgreementResponse = Object.freeze({
      vehicle_id: 7, from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z',
      pair_tolerance_ms: 2000, row_limit: 10000, truncated: true, source_time_only: true,
      generated_at: '2026-01-02T00:01:00Z', status: 'insufficient_overlap',
      agreement_pct: null, scanned_rows: 5, invalid_value_rows: 1,
      http_evidence_rows: 0, mqtt_evidence_rows: 5, comparable_pairs: 0,
      agreeing_pairs: 0, disagreeing_pairs: 0, fields: [],
    });
    render(<TransportAgreementMetrics data={evidence} retained />);
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual([null, 0, 0, 5]);
    const brief = screen.getByTestId('transport-agreement-summary');
    expect(brief.querySelector('[data-operational-metric="agreement"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelector('[data-operational-metric="pairs"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief).toHaveTextContent('Audit generated: 2026-01-02T00:01:00Z');
    expect(screen.getByText('Partial evidence window')).toBeInTheDocument();
    expect(screen.getByText('Excluded malformed typed rows: 1.')).toBeInTheDocument();
    const drawer = review('transport-agreement-summary');
    expect(drawer).toHaveTextContent('N/A');
    expect(drawer).toHaveTextContent('Within 2 seconds');
    expect(drawer).toHaveTextContent('Producer time only; receipt fallbacks excluded');
    expect(drawer).toHaveTextContent('do not prove full-window agreement');
    expect(evidence.agreement_pct).toBeNull();
    expect(evidence.from).toBe('2026-01-01T00:00:00Z');
  });
});
