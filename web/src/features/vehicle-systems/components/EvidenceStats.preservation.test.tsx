import type { ReactElement } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { summarizeCabinThermal } from '../lib/cabinThermal';
import { summarizeComfortConsistency } from '../lib/comfortConsistency';
import { summarizeHvacCycling } from '../lib/hvacCycling';
import { summarizePreconditioningEffectiveness } from '../lib/preconditioningEffectiveness';
import { CabinThermalEvidenceStats } from './cabin-thermal-modernization/CabinThermalEvidenceStats';
import { ComfortConsistencyEvidenceKpiLedger } from './comfort-consistency/ComfortConsistencyEvidenceKpiLedger';
import { HvacCyclingEvidenceKpiLedger } from './hvac-cycling/HvacCyclingEvidenceKpiLedger';
import { PreconditioningEvidenceLedger } from './preconditioning-effectiveness/PreconditioningEvidenceLedger';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? '')),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: 'km', speed: 'km/h', energy: 'kWh', power: 'kW', temperature: '°C',
    pressure: 'bar', duration: 'h', precision: 1, locale: 'en-US',
  } }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

const formatDuration = (value: number | null | undefined) => value == null ? '—' : `${value} s`;
const formatDelta = (value: number | null | undefined) => value == null ? '—' : `${value} °C`;
const sourceState = (resolved: boolean, retained: boolean) => ({
  vehicleSelected: true, hasData: resolved, isFetching: false,
  isLoading: false, isResolved: resolved, isPaused: false,
  error: null, refreshError: retained ? new Error('Read refresh failed') : null, onRetry: vi.fn(),
});

interface Fixture {
  name: string;
  title: string;
  zeroValueIndex: number;
  missingValueIndex: number;
  render: (resolved: boolean, retained: boolean) => ReactElement;
}

const fixtures: Fixture[] = [
  {
    name: 'cabin thermal', title: 'Thermal evidence ledger', zeroValueIndex: 0, missingValueIndex: 5,
    render: (resolved, retained) => <CabinThermalEvidenceStats summary={summarizeCabinThermal([])}
      state={sourceState(resolved, retained)} formatDuration={formatDuration} />,
  },
  {
    name: 'comfort consistency', title: 'Evidence KPI ledger', zeroValueIndex: 1, missingValueIndex: 4,
    render: (resolved, retained) => <ComfortConsistencyEvidenceKpiLedger summary={summarizeComfortConsistency([])}
      state={sourceState(resolved, retained)} formatDuration={formatDuration} formatDelta={formatDelta} />,
  },
  {
    name: 'HVAC cycling', title: 'Evidence KPI ledger', zeroValueIndex: 0, missingValueIndex: 4,
    render: (resolved, retained) => <HvacCyclingEvidenceKpiLedger summary={summarizeHvacCycling([])}
      state={sourceState(resolved, retained)} formatDuration={formatDuration} />,
  },
  {
    name: 'preconditioning', title: 'KPI and evidence ledger', zeroValueIndex: 0, missingValueIndex: 3,
    render: (resolved, retained) => <PreconditioningEvidenceLedger
      summary={summarizePreconditioningEffectiveness([], [])}
      state={{ vehicleSelected: true, climate: sourceState(resolved, retained), drives: sourceState(resolved, false), onRefresh: vi.fn() }}
      formatDelta={formatDelta} />,
  },
];

describe.each(fixtures)('$name actual operational evidence brief', fixture => {
  it('preserves all six unknown metrics before resolution and does not invent a period', () => {
    const { container } = render(fixture.render(false, false));
    const metrics = container.querySelectorAll('[data-operational-metric]');
    expect(metrics).toHaveLength(6);
    for (const metric of metrics) {
      expect(metric).toHaveAttribute('data-value-state', 'missing');
      expect(metric.querySelector('[data-operational-value]')).toHaveTextContent('—');
      expect(metric).toHaveAttribute('role', 'listitem');
    }
    expect(container.querySelector('[data-source-period-kind]')).toHaveAttribute('data-source-period-kind', 'unknown');
    expect(container.querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(within(container).getAllByRole('heading')).toHaveLength(1);
    expect(within(container).getByRole('heading', { name: fixture.title })).toBeInTheDocument();
  });

  it('distinguishes successful observed zero from withheld inference and retains both on refresh failure', () => {
    const view = render(fixture.render(true, false));
    const before = view.container.querySelectorAll('[data-operational-metric]');
    expect(before).toHaveLength(6);
    expect(before[fixture.zeroValueIndex]).toHaveAttribute('data-value-state', 'value');
    expect(before[fixture.zeroValueIndex].querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(before[fixture.missingValueIndex]).toHaveAttribute('data-value-state', 'missing');
    expect(before[fixture.missingValueIndex].querySelector('[data-operational-value]')).toHaveTextContent('—');
    const values = [...before].map(metric => metric.querySelector('[data-operational-value]')?.textContent);
    const states = [...before].map(metric => metric.getAttribute('data-value-state'));
    view.rerender(fixture.render(true, true));
    const after = view.container.querySelectorAll('[data-operational-metric]');
    expect(after).toHaveLength(6);
    expect([...after].map(metric => metric.querySelector('[data-operational-value]')?.textContent)).toEqual(values);
    expect([...after].map(metric => metric.getAttribute('data-value-state')))
      .toEqual(states);
    expect(view.container.querySelector('[data-source-retained]')).toHaveAttribute('data-source-retained', 'true');
    expect(view.container.querySelector('[data-source-period-kind]')).toHaveAttribute('data-source-period-kind', 'unknown');
    expect(within(view.container).getAllByRole('status').some(status => status.textContent?.includes('Showing retained measurements'))).toBe(true);
  });
  it('opens the real retained evidence drawer with every existing measurement label and caption', () => {
    const view = render(fixture.render(true, true));
    const labels = [...view.container.querySelectorAll('[data-operational-metric]')]
      .map(metric => metric.firstElementChild?.firstElementChild?.textContent);
    fireEvent.click(within(view.container).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    for (const label of labels) {
      if (label == null) throw new Error('Missing operational label');
      expect(within(drawer).getByText(label)).toBeInTheDocument();
    }
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
