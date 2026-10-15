import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { UnitPref } from '@/lib/unitConversion';
import type { StatMetric } from '@/components/data-display';
import type { SandboxRunResult } from '../../../lib/sandboxRunner';
import { SandboxRunBrief } from '../SandboxRunBrief';

let sourceMetrics: readonly StatMetric[] = [];
let preferences: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
};

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: preferences }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useOperationalMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return {
    ...actual,
    useOperationalMetrics: (...args: Parameters<typeof actual.useOperationalMetrics>) => {
      sourceMetrics = args[0];
      return actual.useOperationalMetrics(...args);
    },
  };
});

function preparedRun(): SandboxRunResult {
  return { formulas: [], rowsUsed: 5, totalStepsUsed: 117, durationMs: 2.375, truncated: false };
}

function renderBrief(run = preparedRun()) {
  return render(
    <MemoryRouter>
      <SandboxRunBrief run={run} packName="Local sample pack" packVersion="1.2.3"
        grantDescription="Using installed capability grant" />
    </MemoryRouter>,
  );
}

function metric(container: HTMLElement, key: string) {
  const node = container.querySelector(`[data-operational-metric="${key}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing operational metric ${key}`);
  return node;
}

describe('SandboxRunBrief actual raw bridge and drawer', () => {
  beforeEach(() => {
    sourceMetrics = [];
    preferences = { ...preferences, locale: 'en-US', precision: 2 };
  });

  it('retains source counts and canonical elapsed seconds without losing the exact source millisecond display', () => {
    const { container } = renderBrief();
    expect(sourceMetrics.map(({ metricId, rawValue }) => ({ metricId, rawValue }))).toEqual([
      { metricId: 'count', rawValue: 5 },
      { metricId: 'count', rawValue: 117 },
      { metricId: 'latency', rawValue: 0.002375 },
    ]);
    expect(metric(container, 'sandbox-sample-rows')).toHaveAttribute('data-value-state', 'value');
    expect(metric(container, 'sandbox-elapsed-time')).toHaveTextContent('2.375 ms');
    expect(screen.getByText('5 sample rows · 117 evaluation steps · 2.375ms')).toBeInTheDocument();
    expect(screen.getByText(/not a subscription or evidence of model accuracy/i)).toBeInTheDocument();
    expect(screen.getByText('Local sample pack · v1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Selected run; no vehicle-data timestamp')).toBeInTheDocument();
  });

  it('shows genuine measured zero and does not present invalid counts or elapsed values as zero', () => {
    const { container, rerender } = renderBrief({
      ...preparedRun(), rowsUsed: 0, totalStepsUsed: 0, durationMs: 0,
    });
    for (const key of ['sandbox-sample-rows', 'sandbox-evaluation-steps', 'sandbox-elapsed-time']) {
      const node = metric(container, key);
      expect(node).toHaveAttribute('data-value-state', 'value');
      expect(node.querySelector('[data-operational-value]')).toHaveTextContent(/^0(?: ms)?$/);
    }
    rerender(
      <MemoryRouter>
        <SandboxRunBrief run={{ ...preparedRun(), rowsUsed: -1, totalStepsUsed: 1.5, durationMs: NaN }}
          packName="Invalid sample" packVersion="1.0.0" grantDescription="Simulated grant" />
      </MemoryRouter>,
    );
    for (const key of ['sandbox-sample-rows', 'sandbox-evaluation-steps', 'sandbox-elapsed-time']) {
      const node = metric(container, key);
      expect(node).toHaveAttribute('data-value-state', 'invalid');
      expect(node.querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
  });

  it('keeps partial-output limitations, source operands and the installed grant reviewable in the real details drawer', () => {
    renderBrief({ ...preparedRun(), truncated: true });
    expect(screen.getByText('5 sample rows · 117 evaluation steps · 2.375ms · truncated by budget')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Selected pack evaluation details' });
    expect(within(drawer).getByText(/Local bounded interpreter over bundled synthetic sample data/i))
      .toHaveTextContent('Using installed capability grant');
    expect(within(drawer).getByText('5 sample rows · 117 evaluation steps · 2.375ms · truncated by budget'))
      .toBeInTheDocument();
    expect(within(drawer).getAllByText(/no analytical accuracy or confidence is inferred/i)).toHaveLength(3);
    expect(within(drawer).getByText('2.375 ms')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
  });

  it('uses saved locale for numerical counts while preserving the original specialist elapsed presentation', () => {
    preferences = { ...preferences, locale: 'de-DE', precision: 4 };
    const { container } = renderBrief({ ...preparedRun(), rowsUsed: 1234, totalStepsUsed: 9876 });
    expect(metric(container, 'sandbox-sample-rows').querySelector('[data-operational-value]'))
      .toHaveTextContent('1.234');
    expect(metric(container, 'sandbox-evaluation-steps').querySelector('[data-operational-value]'))
      .toHaveTextContent('9.876');
    expect(metric(container, 'sandbox-elapsed-time').querySelector('[data-operational-value]'))
      .toHaveTextContent('2.375 ms');
    expect(sourceMetrics[2].rawValue).toBe(0.002375);
  });
});
