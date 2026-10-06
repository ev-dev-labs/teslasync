import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
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

const formatDuration = (value: number | null | undefined) => value == null ? '—' : `${value} s`;
const formatDelta = (value: number | null | undefined) => value == null ? '—' : `${value} °C`;
const sourceState = (resolved: boolean, retained: boolean) => ({
  vehicleSelected: true, hasData: resolved, isFetching: false,
  isLoading: false, isResolved: resolved, isPaused: false,
  error: null, refreshError: retained ? new Error('Read refresh failed') : null, onRetry: vi.fn(),
});

interface Fixture {
  name: string;
  zeroValueIndex: number;
  missingValueIndex: number;
  render: (resolved: boolean, retained: boolean) => ReactElement;
}

const fixtures: Fixture[] = [
  {
    name: 'cabin thermal', zeroValueIndex: 0, missingValueIndex: 5,
    render: (resolved, retained) => <CabinThermalEvidenceStats summary={summarizeCabinThermal([])}
      state={sourceState(resolved, retained)} formatDuration={formatDuration} />,
  },
  {
    name: 'comfort consistency', zeroValueIndex: 1, missingValueIndex: 4,
    render: (resolved, retained) => <ComfortConsistencyEvidenceKpiLedger summary={summarizeComfortConsistency([])}
      state={sourceState(resolved, retained)} formatDuration={formatDuration} formatDelta={formatDelta} />,
  },
  {
    name: 'HVAC cycling', zeroValueIndex: 0, missingValueIndex: 4,
    render: (resolved, retained) => <HvacCyclingEvidenceKpiLedger summary={summarizeHvacCycling([])}
      state={sourceState(resolved, retained)} formatDuration={formatDuration} />,
  },
  {
    name: 'preconditioning', zeroValueIndex: 0, missingValueIndex: 3,
    render: (resolved, retained) => <PreconditioningEvidenceLedger
      summary={summarizePreconditioningEffectiveness([], [])}
      state={{ vehicleSelected: true, climate: sourceState(resolved, retained), drives: sourceState(resolved, false), onRefresh: vi.fn() }}
      formatDelta={formatDelta} />,
  },
];

describe.each(fixtures)('$name canonical evidence strip', fixture => {
  it('preserves all six unknown metrics before resolution and does not invent a period', () => {
    const { container } = render(fixture.render(false, false));
    const metrics = container.querySelectorAll('[data-stat]');
    expect(metrics).toHaveLength(6);
    for (const metric of metrics) expect(metric).toHaveAttribute('data-state', 'missing');
    expect(container.querySelector('[data-stat-strip]')).toHaveAttribute('data-period-kind', 'unknown');
    expect(container.querySelectorAll('h2')).toHaveLength(1);
  });

  it('distinguishes successful observed zero from withheld inference and retains both on refresh failure', () => {
    const view = render(fixture.render(true, false));
    const before = view.container.querySelectorAll('[data-stat]');
    expect(before).toHaveLength(6);
    expect(before[fixture.zeroValueIndex]).toHaveAttribute('data-state', 'value');
    expect(before[fixture.zeroValueIndex].querySelector('[data-stat-value]')).toHaveTextContent('0');
    expect(before[fixture.missingValueIndex]).toHaveAttribute('data-state', 'missing');
    const values = [...before].map(metric => metric.querySelector('[data-stat-value]')?.textContent);
    view.rerender(fixture.render(true, true));
    const after = view.container.querySelectorAll('[data-stat]');
    expect([...after].map(metric => metric.querySelector('[data-stat-value]')?.textContent)).toEqual(values);
    expect(view.container.querySelector('[data-stat-strip]')).toHaveAttribute('data-retained', 'true');
  });
});
