import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expectAppDesignDataMode, matchesAppDesignCss, setAppDesignTestProfile } from '@/components/feedback/appDesignCss.test-utils';
import { APPLICATION_DESIGNS, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { FirmwareImpact } from '../../lib/firmwareImpact';
import { FirmwareImpactDetails } from './FirmwareImpactDetails';
import { firmwareImpactState } from './firmwareImpactState';

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
  return render(<MemoryRouter><FirmwareImpactDetails
    summary={{ impacts: [row], skipped: 0, significantCount: 1, analyzedDrives: 17 }}
    state={sourceState} onRetry={vi.fn()}
  /></MemoryRouter>);
}

describe('firmware version evidence is lossless and missing-aware', () => {
  it('keeps row headers, sample sizes, signed precision and specialist statistical formatting', () => {
    const row = impact();
    const before = JSON.stringify(row);
    show(row);
    const table = screen.getByRole('table', { name: row.version });
    const record = table.closest('[data-app-card-kind="record"]')!;
    expect(record.tagName).toBe('LI');
    expect(record.parentElement).toHaveAttribute('data-app-list', 'records');
    expect(table.closest('[data-app-part="record-body"]')?.parentElement).toBe(record);
    expect(record.querySelector('[data-app-part="record-header"]')).toHaveTextContent(row.version);
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
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('connects each actual record header, body and evidence slot to all design data compositions', () => {
    const row = impact({ version: '2026.20 long retained software version identifier' });
    const { container } = show(row);
    const table = screen.getByRole('table', { name: row.version });
    const record = table.closest('[data-app-card-kind="record"]')!;
    const original = record.textContent;
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      setAppDesignTestProfile(container, pack);
      const release = observeAppDesignScopes(container);
      try {
        const mode = APPLICATION_DESIGNS[pack].data;
        expectAppDesignDataMode(record, mode, '[data-app-card-kind="record"]');
        for (const part of ['record-header', 'record-body', 'record-title', 'record-context']) {
          expectAppDesignDataMode(record.querySelector(`[data-app-part="${part}"]`)!, mode, `[data-app-part~="${part}"]`);
        }
        const body = record.querySelector('[data-app-part="record-body"]')!;
        for (const match of matchesAppDesignCss(body)) {
          expect(match.declarations).not.toHaveProperty('display');
          expect(match.declarations).not.toHaveProperty('grid-template-columns');
        }
        expect(within(table).getAllByRole('rowheader')).toHaveLength(4);
        expect(record.textContent).toBe(original);
      } finally { release(); }
    }
    expect(within(record as HTMLElement).getByText('More efficient')).toHaveAttribute('data-app-variant', 'success');
  });

  it('keeps the shell and offers recovery on initial failure, without rendering fabricated comparisons', () => {
    const retry = vi.fn();
    render(<MemoryRouter><FirmwareImpactDetails
      summary={{ impacts: [impact()], skipped: 0, significantCount: 1, analyzedDrives: 17 }}
      state={firmwareImpactState({ error: new Error('failed') }, { data: [] })}
      onRetry={retry}
    /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Version by version' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
