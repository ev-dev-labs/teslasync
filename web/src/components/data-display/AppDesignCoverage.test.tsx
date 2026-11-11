import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getAppDesignAttributes, APPLICATION_DESIGNS } from '../ui/app-designs/designs';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import { StatCard } from './StatCard';
import { MetricTile } from './MetricTile';
import { KVList } from './KVList';
import { StatusBadge } from './StatusBadge';
import { DataProvenanceBadge } from './DataProvenanceBadge';
import { Timeline } from './Timeline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number, decimals = 2) => new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value),
    fmtInt: (value: number) => new Intl.NumberFormat('de-DE', {
      maximumFractionDigits: 0,
    }).format(value),
  }),
}));

describe('application design data composition contract', () => {
  it.each(Object.keys(APPLICATION_DESIGNS) as PackId[])(
    '%s keeps formatted, missing and loading readings distinct at real styling targets',
    (pack) => {
      const { container } = render(
        <div data-app-design-preview {...getAppDesignAttributes(pack)} dir="rtl">
          <StatCard label="Distance" value={0} kind="measurement" unit="km" />
          <MetricTile label="Temperature" value={-12.5} decimals={2} unit="°C" />
          <MetricTile label="Energy" value={null} unit="Wh" />
          <StatCard label="Pending measurement" value={91} unit="kPa" loading />
          <KVList items={[{ label: 'Vehicle identifier', value: '000123456789' }]} />
          <StatusBadge status={null} />
          <DataProvenanceBadge provenance="live" status="stale" />
          <Timeline items={[]} emptyMessage="No observations in this range" />
        </div>,
      );

      expect(screen.getByText('0,00')).toHaveAttribute('data-app-part', 'metric-value');
      expect(screen.getByText('-12,50')).toHaveAttribute('data-app-part', 'metric-value');
      expect(screen.getByText('°C')).toHaveAttribute('data-app-part', 'metric-unit');
      expect(screen.getByText('000123456789')).toBeInTheDocument();
      expect(screen.queryByText('Wh')).not.toBeInTheDocument();
      expect(screen.queryByText('kPa')).not.toBeInTheDocument();
      expect(screen.queryByText('91')).not.toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
      const missing = container.querySelector('[data-app-metric="tile"][data-app-state="missing"]')!;
      expect(within(missing as HTMLElement).getByText('—')).toBeInTheDocument();
      const source = container.querySelector('[data-provenance="live"]')!;
      expect(source).toHaveAttribute('data-data-status', 'stale');
      expect(source).toHaveClass('text-[var(--text-secondary)]');
      expect(container.querySelector('[data-app-part~="status"][data-app-part~="badge"]')).toHaveTextContent('—');
      expect(screen.getByText('No observations in this range')).toHaveAttribute('role', 'status');
    },
  );
});
