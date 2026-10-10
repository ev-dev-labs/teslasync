import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { summarizeCabinThermal } from '../../lib/cabinThermal';
import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { summarizeHvacCycling } from '../../lib/hvacCycling';
import { summarizePreconditioningEffectiveness } from '../../lib/preconditioningEffectiveness';
import { CabinThermalAccountingMatrix } from '../cabin-thermal/CabinThermalAccountingMatrix';
import { ComfortConsistencyExactAccounting } from '../comfort-consistency/ComfortConsistencyExactAccounting';
import { HvacCyclingExactAccounting } from '../hvac-cycling/HvacCyclingExactAccounting';
import { PreconditioningSourceCoverage } from '../preconditioning-effectiveness/PreconditioningSourceCoverage';
import { SourceAvailabilityBrief } from './SourceAvailabilityBrief';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown> & { replace?: Record<string, unknown> }) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.replace?.[name] ?? values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { duration: 's', locale: 'en-US', precision: 2 } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: number) => String(Math.round(value)),
    fmtNumber: (value: number) => value.toFixed(2),
    fmtPercent: (value: number) => `${value.toFixed(2)}%`,
    locale: 'en-US', precision: 2,
  }),
}));

const duration = (raw: number | null | undefined) => raw == null ? '—' : `${raw} s`;
const state = (retained = false) => ({
  vehicleSelected: true, isLoading: false, isResolved: true, isPaused: false,
  error: null, refreshError: retained ? new Error('Fake refresh failed') : null,
  onRetry: vi.fn(),
});
const source = (resolved: boolean, retained = false) => ({
  ...state(retained), hasData: resolved, isResolved: resolved, isFetching: false,
});

describe('secondary banks use the actual Brief without replacing accounting identities', () => {
  const fixtures = [
    {
      id: 'cabin-thermal-exclusions-summary', identity: 'Raw-row identity',
      render: (retained: boolean) => <CabinThermalAccountingMatrix
        summary={summarizeCabinThermal([])} state={state(retained)} />,
    },
    {
      id: 'comfort-consistency-boundary-summary', identity: 'Returned-row identity',
      render: (retained: boolean) => <ComfortConsistencyExactAccounting
        summary={summarizeComfortConsistency([])} state={state(retained)} formatDuration={duration} />,
    },
    {
      id: 'hvac-cycling-outcome-summary', identity: 'Returned-row identity',
      render: (retained: boolean) => <HvacCyclingExactAccounting
        summary={summarizeHvacCycling([])} state={state(retained)} />,
    },
  ];

  it.each(fixtures)('retains measured zero, identities and real drawer for $id', fixture => {
    const view = render(fixture.render(false));
    const brief = screen.getByTestId(fixture.id);
    const before = [...brief.querySelectorAll('[data-operational-metric]')].map(metric => ({
      state: metric.getAttribute('data-value-state'),
      value: metric.querySelector('[data-operational-value]')?.textContent,
    }));
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(metric => metric.state === 'value' && metric.value === '0')).toBe(true);
    expect(screen.getByText(fixture.identity)).toBeInTheDocument();
    view.rerender(fixture.render(true));
    expect(screen.getByTestId(fixture.id).parentElement).toHaveAttribute('data-source-retained', 'true');
    expect([...screen.getByTestId(fixture.id).querySelectorAll('[data-operational-metric]')].map(metric => ({
      state: metric.getAttribute('data-value-state'),
      value: metric.querySelector('[data-operational-value]')?.textContent,
    }))).toEqual(before);
    fireEvent.click(within(screen.getByTestId(fixture.id)).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Operational metrics')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText('Close', { selector: '[data-drawer-header] button' }));
    expect(screen.getByText(fixture.identity)).toBeInTheDocument();
  });

  it('keeps independent unresolved climate counts separate from successful zero drive rows', () => {
    const summary = summarizePreconditioningEffectiveness([], []);
    const view = render(<PreconditioningSourceCoverage summary={summary}
      state={{ vehicleSelected: true, climate: source(false), drives: source(true), onRefresh: vi.fn() }}
      formatDuration={duration} locale="en-US" />);
    const climate = screen.getByTestId('preconditioning-climate-source-summary');
    const drives = screen.getByTestId('preconditioning-drive-source-summary');
    expect([...climate.querySelectorAll('[data-operational-metric]')]
      .every(metric => metric.getAttribute('data-value-state') === 'missing')).toBe(true);
    expect(drives.querySelector('[data-operational-metric="returned"]')).toHaveAttribute('data-value-state', 'value');
    expect(drives.querySelector('[data-operational-metric="returned"] [data-operational-value]')).toHaveTextContent('0');
    expect(drives.querySelector('[data-operational-metric="overlap"]')).toHaveAttribute('data-value-state', 'missing');
    view.rerender(<PreconditioningSourceCoverage summary={summary}
      state={{ vehicleSelected: true, climate: source(true, true), drives: source(true), onRefresh: vi.fn() }}
      formatDuration={duration} locale="en-US" />);
    expect(screen.getByTestId('preconditioning-climate-source-summary').parentElement).toHaveAttribute('data-source-retained', 'true');
    expect(screen.getByTestId('preconditioning-drive-source-summary').parentElement).not.toHaveAttribute('data-source-retained');
    expect(screen.getAllByText(/endpoint defaults to seven days/).length).toBeGreaterThan(0);
    expect(screen.getByText(/endpoint limit 1,000 rows/)).toBeInTheDocument();
  });

  it('retains source counts and withholds percentages when the original denominator is zero', () => {
    render(<SourceAvailabilityBrief id="field-availability" title="Source availability"
      denominator={0} retained items={[{ id: 'power', label: 'HVAC power', count: 0,
        note: 'Known state does not imply an independent measurement.' }]}
      period={{ kind: 'unknown', label: 'Returned climate rows', reason: 'Unique timestamp-valid rows only.' }} />);
    const brief = screen.getByTestId('field-availability');
    const metric = brief.querySelector('[data-operational-metric="power"]');
    expect(metric).toHaveAttribute('data-value-state', 'value');
    expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent('0 · —');
    expect(within(brief).queryByText('0.00%')).not.toBeInTheDocument();
    expect(brief.parentElement).toHaveAttribute('data-source-retained', 'true');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Known state does not imply an independent measurement.')).toBeInTheDocument();
    expect(within(dialog).getByText('Counts are evaluated against 0 unique timestamp-valid rows.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText('Close', { selector: '[data-drawer-header] button' }));
  });
});
