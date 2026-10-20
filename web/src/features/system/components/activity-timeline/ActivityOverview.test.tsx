import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityOverview } from './ActivityOverview';
import { getGlobalLocale, setGlobalLocale } from '@/lib/numberFormat';
import type { ActivityItem } from '@/types/activity';
import type { StatMetric } from '@/components/data-display/stat-reference/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
        values?.[name] != null ? String(values[name]) : '',
      ),
  }),
}));

interface SummaryProps {
  title: string;
  available: boolean;
  loading: boolean;
  retained: boolean;
  metrics: readonly StatMetric[];
}

vi.mock('../operationalbrief-all/SystemSummaryBrief', () => ({
  SystemSummaryBrief: ({ title, available, loading, retained, metrics }: SummaryProps) => (
    <section aria-label={title} data-available={available} data-loading={loading} data-retained={retained}>
      {metrics.map((metric) => (
        <p key={metric.occurrenceId} data-testid={metric.occurrenceId} data-raw={metric.rawValue ?? 'unknown'}>
          {metric.label}
        </p>
      ))}
    </section>
  ),
}));

const event: ActivityItem = {
  id: 'drives:1', kind: 'drive', occurred_at: '2026-01-15T12:00:00Z',
  title: 'Drive', summary: '', status: 'completed', source_table: 'drives', source_id: 1,
};
const coverage = () => screen.getByText(/Counts below describe only the loaded page/);
let previousLocale: string;

describe('ActivityOverview', () => {
  beforeEach(() => {
    previousLocale = getGlobalLocale();
    setGlobalLocale('de-DE');
  });
  afterEach(() => {
    act(() => setGlobalLocale(previousLocale));
  });

  it('formats both loaded-page ordinals and total with selected numeric preferences while retaining raw metrics', () => {
    render(<ActivityOverview items={[event]} total={12_345} offset={1_234}
      loading={false} error={false} timezone="UTC" />);
    expect(coverage()).toHaveTextContent('events 1.235–1.235 of 12.345');
    expect(screen.getByTestId('range-total')).toHaveAttribute('data-raw', '12345');
    expect(screen.getByTestId('page-events')).toHaveAttribute('data-raw', '1');
    expect(screen.getByTestId('page-days')).toHaveAttribute('data-raw', '1');
    expect(screen.getByTestId('page-critical')).toHaveAttribute('data-raw', '0');
  });

  it('reacts to saved locale changes without refetching or rewriting counts', () => {
    render(<ActivityOverview items={[event]} total={12_345} offset={1_234}
      loading={false} error={false} />);
    expect(coverage()).toHaveTextContent('1.235–1.235 of 12.345');
    act(() => setGlobalLocale('en-US'));
    expect(coverage()).toHaveTextContent('1,235–1,235 of 12,345');
    expect(screen.getByTestId('range-total')).toHaveAttribute('data-raw', '12345');
  });

  it('keeps empty-page zero ordinals and all category sections visible', () => {
    render(<ActivityOverview items={[]} total={0} offset={1_234}
      loading={false} error={false} />);
    expect(coverage()).toHaveTextContent('events 0–0 of 0');
    expect(screen.getByRole('region', { name: 'Activity overview' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Event types on this page' })).toBeInTheDocument();
    for (const kind of ['drive', 'charging', 'alert', 'software_update', 'annotation']) {
      expect(screen.getByTestId(kind)).toHaveAttribute('data-raw', '0');
    }
  });

  it('retains page counts and source state through a refresh failure', () => {
    render(<ActivityOverview items={[event]} total={12_345} offset={1_234}
      loading={false} error={false} available retained />);
    expect(coverage()).toHaveTextContent('events 1.235–1.235 of 12.345');
    expect(screen.getByRole('region', { name: 'Range and page counts' }))
      .toHaveAttribute('data-retained', 'true');
    expect(screen.getByTestId('page-events')).toHaveAttribute('data-raw', '1');
  });

  it('keeps unavailable and loading sections with unknown raw counts rather than fabricated zero', () => {
    const { rerender } = render(<ActivityOverview items={[]} total={0} offset={0}
      loading={false} error available={false} />);
    expect(coverage()).toHaveTextContent('events 0–0 of —');
    expect(screen.getByTestId('range-total')).toHaveAttribute('data-raw', 'unknown');
    expect(screen.getByTestId('drive')).toHaveAttribute('data-raw', 'unknown');
    rerender(<ActivityOverview items={[]} total={0} offset={0}
      loading error={false} available={false} />);
    expect(screen.getByRole('region', { name: 'Range and page counts' }))
      .toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('page-events')).toHaveAttribute('data-raw', 'unknown');
  });
});
