import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChargeRateStats } from './helpers';
import { ChargeRatePanel } from './ChargeRatePanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      return fallback.replace(/{{(\w+)}}/g, (_match, name: string) =>
        String(options?.[name] ?? `{{${name}}}`),
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatPower: (value: number) => `${(value / 1000).toFixed(2)} kW`,
    formatEnergy: (value: number) => `${(value / 1000).toFixed(2)} kWh`,
    formatDuration: (value: number) => `${(value / 3600).toFixed(2)} h`,
  }),
}));

vi.mock('@/lib/dateFormat', () => ({
  formatDateTime: (iso?: string | Date | null) => iso ? `dt(${String(iso)})` : '—',
}));

const STATS: ChargeRateStats = {
  averagePowerW: 20_000,
  best: { id: 1, date: '2026-04-15T12:00:00Z', powerW: 30_000 },
  worst: { id: 2, date: '2026-01-02T08:30:00Z', powerW: 10_000 },
  totalEnergyWh: 40_000,
  totalDurationS: 7_200,
  count: 2,
};

function metricByLabel(label: string): HTMLElement {
  const panel = screen.getByText(label).closest('[data-print-card]');
  if (!panel) throw new Error(`No metric panel found for "${label}"`);
  return panel as HTMLElement;
}

describe('ChargeRatePanel', () => {
  it('labels throughput as delivery rate instead of claiming conversion efficiency', () => {
    render(<ChargeRatePanel stats={STATS} />);

    expect(screen.getByRole('heading', { name: 'Charging delivery rate' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Observed energy per elapsed hour; this is power delivery, not wall-to-battery efficiency.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Average Efficiency')).not.toBeInTheDocument();
    expect(screen.queryByText('Wall-to-Battery Loss')).not.toBeInTheDocument();
  });

  it('renders SI-derived power, energy, duration, and session evidence', () => {
    render(<ChargeRatePanel stats={STATS} />);

    expect(within(metricByLabel('Average delivery rate')).getByText('20.00 kW')).toBeInTheDocument();
    expect(within(metricByLabel('Highest-rate session')).getByText('30.00 kW')).toBeInTheDocument();
    expect(
      within(metricByLabel('Highest-rate session')).getByText('dt(2026-04-15T12:00:00Z)'),
    ).toBeInTheDocument();
    expect(within(metricByLabel('Lowest-rate session')).getByText('10.00 kW')).toBeInTheDocument();
    expect(within(metricByLabel('Observed delivery')).getByText('40.00 kWh')).toBeInTheDocument();
    expect(metricByLabel('Observed delivery')).toHaveTextContent('2.00 h across 2 sessions');
  });
});
