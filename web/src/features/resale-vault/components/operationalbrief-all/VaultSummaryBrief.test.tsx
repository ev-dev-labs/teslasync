import { describe, expect, it } from 'vitest';
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { deriveDataState } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { VaultEvidenceSource } from '../../hooks/useVaultEvidence';
import { VaultSummaryBrief } from './VaultSummaryBrief';

const metrics: readonly StatMetric[] = [
  { metricId: 'count', occurrenceId: 'records', rawValue: 0, label: 'Observed records', description: 'Returned records only.' },
  { metricId: 'energy', occurrenceId: 'capacity', rawValue: null, label: 'Recorded capacity', description: 'Wh input.' },
];
const props = {
  id: 'test',
  title: 'Retained record summary',
  description: 'No lifetime coverage is claimed.',
  metrics,
  hasEvidence: true,
  scope: 'Account-wide records; bounds unknown.',
};

function source(query: Parameters<typeof deriveDataState<unknown>>[0]): VaultEvidenceSource {
  return {
    id: 'maintenance', section: 'maintenance', labelKey: 'resaleVault.maintenance.title',
    label: 'Maintenance & service', loading: Boolean(query.isLoading),
    state: deriveDataState(query),
  };
}

describe('VaultSummaryBrief retained evidence and real drawer', () => {
  it('retains numeric raw measurements and validation states through the actual bridge', () => {
    const input: readonly StatMetric[] = [
      ...metrics,
      { metricId: 'energy', occurrenceId: 'invalid', rawValue: Number.NaN },
      { metricId: 'number', occurrenceId: 'fractional-cycles', rawValue: 210.5 },
    ];
    const { result } = renderHook(() => useOperationalMetrics(input));
    expect(result.current[0]).toMatchObject({ key: 'records', rawValue: 0, valueState: 'value', value: '0' });
    expect(result.current[1]).toMatchObject({ rawValue: null, valueState: 'missing', value: '—' });
    expect(result.current[2]?.rawValue).toBeNaN();
    expect(result.current[2]?.valueState).toBe('invalid');
    expect(result.current[3]?.rawValue).toBe(210.5);
  });

  it('keeps retained zero and missing readings visible during a failed refresh and its own recovery', () => {
    const retained = source({ data: [], isError: true, error: new Error('refresh failed') });
    const { rerender } = render(<VaultSummaryBrief {...props} sources={[retained]} />);
    const brief = screen.getByTestId('vault-test-brief');
    expect(within(brief).getByText('Retained evidence')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="records"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="capacity"]')).toHaveAttribute('data-value-state', 'missing');
    expect(within(brief).getByText('0')).toBeInTheDocument();
    rerender(<VaultSummaryBrief {...props} sources={[source({ data: [], isSuccess: true })]} />);
    expect(within(brief).getByText('Evidence available')).toBeInTheDocument();
    expect(within(brief).queryByText('Retained evidence')).not.toBeInTheDocument();
    expect(within(brief).getByText('0')).toBeInTheDocument();
  });

  it('keeps paused refresh evidence without presenting it as a fresh reading', () => {
    render(<VaultSummaryBrief {...props} sources={[source({ data: [], fetchStatus: 'paused' })]} />);
    expect(screen.getByText('Retained evidence')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('marks initial loading busy without exposing a fabricated zero value', () => {
    render(<VaultSummaryBrief {...props} hasEvidence={false}
      metrics={metrics.map((metric) => ({ ...metric, rawValue: null }))}
      sources={[source({ isLoading: true })]} />);
    const brief = screen.getByTestId('vault-test-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(within(brief).getByText('Loading evidence')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    expect(within(brief).queryByText('0')).not.toBeInTheDocument();
  });

  it('opens the actual Review details drawer with complete scope, missing reason and unscored confidence', () => {
    render(<VaultSummaryBrief {...props} provenance="Existing evidence source" />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('No measurement supplied')).toBeInTheDocument();
    expect(within(drawer).getByText('Account-wide records; bounds unknown.', { selector: '[data-drawer-header] span' })).toBeInTheDocument();
    expect(within(drawer).getAllByText('Account-wide records; bounds unknown.', { selector: 'div' })).toHaveLength(2);
    expect(within(drawer).getByText('Existing evidence source')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getByText('0')).toBeInTheDocument();
  });
});
