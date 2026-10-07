import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FirmwareImpact } from '../../lib/firmwareImpact';
import { FirmwareImpactDetails } from './FirmwareImpactDetails';
import { firmwareImpactState } from './firmwareImpactState';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? '')),
  }),
}));
vi.mock('@/components/layout/layout-reference', () => ({
  LayoutCard: ({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) =>
    <section aria-label={title}>{actions}{children}</section>,
}));
vi.mock('@/components/ui', () => ({
  Table: ({ children, ...props }: { children: ReactNode; 'aria-label': string }) => <table {...props}>{children}</table>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  HelpTooltip: () => <span>verdict methodology</span>,
}));
vi.mock('@/components/feedback', () => ({
  Skeleton: () => <span role="status">initial loading</span>,
  EmptyState: ({ message }: { message: string }) => <span>{message}</span>,
  QueryError: ({ onRetry }: { onRetry: () => void }) => <button onClick={onRetry}>Retry source</button>,
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtScientificNumber: (value: number, precision: number) => `p:${value}:${precision}`,
    fmtNumber: (value: number) => `d:${value}`,
  }),
}));
afterEach(cleanup);

function impact(overrides: Partial<FirmwareImpact> = {}): FirmwareImpact {
  return {
    version: '2026.20', installedAt: '2026-04-01T00:00:00Z', installedMs: 1775001600000,
    before: { n: 8, meanWhPerKm: 180.3, sdWhPerKm: 10, totalDistanceM: 400000 },
    after: { n: 9, meanWhPerKm: 160.2, sdWhPerKm: 10, totalDistanceM: 450000 },
    deltaWhPerKm: -20.1, deltaShare: -0.111, t: -4.1, df: 14.3, p: 0.002, cohensD: -2.01,
    verdict: 'better',
    ...overrides,
  };
}
function show(row: FirmwareImpact, sourceState = firmwareImpactState({ data: [] }, { data: [] })) {
  return render(<FirmwareImpactDetails
    summary={{ impacts: [row], skipped: 0, significantCount: 1, analyzedDrives: 17 }}
    state={sourceState} onRetry={vi.fn()}
  />);
}

describe('firmware version evidence is lossless and missing-aware', () => {
  it('keeps row headers, sample sizes, signed precision and specialist statistical formatting', () => {
    const row = impact();
    const before = JSON.stringify(row);
    show(row);
    const table = screen.getByRole('table', { name: row.version });
    expect(within(table).getAllByRole('rowheader')).toHaveLength(4);
    expect(within(table).getByText('180 Wh/km · n=8')).toBeInTheDocument();
    expect(within(table).getByText('160 Wh/km · n=9')).toBeInTheDocument();
    expect(within(table).getByText('-20.1 Wh/km (-11.1%)')).toBeInTheDocument();
    expect(within(table).getByText('p:0.002:3 · d:2.01')).toBeInTheDocument();
    expect(screen.getByText('More efficient')).toBeInTheDocument();
    expect(JSON.stringify(row)).toBe(before);
  });

  it('preserves plus signs and the small p-value threshold', () => {
    show(impact({ deltaWhPerKm: 20.1, deltaShare: 0.111, p: 0.0004, cohensD: 2.01, verdict: 'worse' }));
    expect(screen.getByText('+20.1 Wh/km (+11.1%)')).toBeInTheDocument();
    expect(screen.getByText('<0.001 · d:2.01')).toBeInTheDocument();
    expect(screen.getByText('Less efficient')).toBeInTheDocument();
  });

  it('keeps absent samples distinct from measured zero, without changing the model sentinels', () => {
    const row = impact({
      before: { n: 0, meanWhPerKm: 0, sdWhPerKm: 0, totalDistanceM: 0 },
      deltaWhPerKm: 160.2, deltaShare: 0, p: null, cohensD: null, verdict: 'insufficient',
    });
    show(row);
    expect(screen.getByText('— Wh/km · n=0')).toBeInTheDocument();
    expect(screen.queryByText('0 Wh/km · n=0')).not.toBeInTheDocument();
    expect(screen.queryByText('+160.2 Wh/km (0%)')).not.toBeInTheDocument();
    expect(screen.getByText('Not enough drives')).toBeInTheDocument();
    expect(row.before.meanWhPerKm).toBe(0);
    expect(row.deltaWhPerKm).toBe(160.2);
  });

  it('renders retained evidence during a background error', () => {
    show(impact(), firmwareImpactState({ data: [], error: new Error('offline') }, { data: [] }));
    expect(screen.getByRole('table', { name: '2026.20' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry source' })).not.toBeInTheDocument();
  });

  it('keeps the shell and offers recovery on initial failure, without rendering fabricated comparisons', () => {
    const retry = vi.fn();
    render(<FirmwareImpactDetails
      summary={{ impacts: [impact()], skipped: 0, significantCount: 1, analyzedDrives: 17 }}
      state={firmwareImpactState({ error: new Error('failed') }, { data: [] })}
      onRetry={retry}
    />);
    expect(screen.getByRole('region', { name: 'Version by version' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
