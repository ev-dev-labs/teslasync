/** AUTHORED NOT RUN: additive regressions for the parent's acceptance window. */
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { deriveDataState } from '@/api/dataState';
import { fmtNumber, getFormatterPreferences } from '@/lib/numberFormat';
import { EfficiencyScatter } from './EfficiencyScatter';
import { EfficiencyTrend } from './EfficiencyTrend';
import { EfficiencySpeedDistribution } from './EfficiencySpeedDistribution';
import { buildEfficiencyModel } from './model';
import { fakeDrive, fakeQuery, fakeUnits } from './fixtures';
import type { SourcePresentation } from './types';

vi.mock('@/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn().mockResolvedValue([]) };
});

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <MemoryRouter initialEntries={['/efficiency']}>
    <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  </MemoryRouter>;
}

function measurement(value: number) {
  const { precision, locale } = getFormatterPreferences();
  return fmtNumber(value, precision, locale);
}

function bodyCells(table: HTMLElement) {
  return within(table).getAllByRole('row').slice(1)
    .map(row => within(row).getAllByRole('cell').map(cell => cell.textContent));
}

describe('efficiency chart data alternatives (AUTHORED NOT RUN)', () => {
  it.each([false, true])('exposes every plotted observation in display units (miles=%s)', miles => {
    const units = fakeUnits(miles);
    // Distinct dates/distances preserve trend order and the newest-30 source scope.
    const rows = Array.from({ length: 40 }, (_, id) => fakeDrive({
      id, startTs: new Date(Date.UTC(2026, 9, 4, 12, -id)).toISOString(),
      distanceM: 50000 + id * 1000, energyUsedWh: (50000 + id * 1000) * 0.15,
    }));
    const model = buildEfficiencyModel(rows, units.unitPrefs);
    const source: SourcePresentation = {
      state: deriveDataState(fakeQuery(rows)), loading: false, malformed: false,
    };
    render(<>
      <EfficiencyTrend model={model} units={units} source={source} selectedVehicleId={1} />
      <EfficiencyScatter model={model} units={units} source={source} kind="speed" />
      <EfficiencyScatter model={model} units={units} source={source} kind="temperature" />
      <EfficiencySpeedDistribution model={model} units={units} source={source} />
    </>, { wrapper: Providers });

    const efficiencyUnit = miles ? 'Wh/mi' : 'Wh/km';
    const speedTable = screen.getByRole('table', { name: 'Speed vs efficiency — data table' });
    const tempTable = screen.getByRole('table', { name: 'Temperature vs efficiency — data table' });
    const trendTable = screen.getByRole('table', { name: `Daily Efficiency (${efficiencyUnit}) — data table` });
    const distributionTable = screen.getByRole('table', { name: 'Efficiency by speed range — data table' });
    expect(screen.getAllByRole('figure')).toHaveLength(4);
    expect(screen.getAllByRole('table')).toHaveLength(4);
    expect(within(speedTable).getByRole('columnheader', {
      name: `Average drive speed (${units.unitPrefs.speed})`,
    })).toHaveAttribute('scope', 'col');
    expect(within(tempTable).getByRole('columnheader', {
      name: `Average outside temperature (${units.unitPrefs.temperature})`,
    })).toHaveAttribute('scope', 'col');
    for (const table of [speedTable, tempTable, trendTable]) {
      expect(within(table).getByRole('columnheader', {
        name: `Drive energy consumption (${efficiencyUnit})`,
      })).toHaveAttribute('scope', 'col');
    }
    expect(within(trendTable).getByRole('columnheader', {
      name: `Drive distance (${units.unitPrefs.distance})`,
    })).toHaveAttribute('scope', 'col');
    expect(within(distributionTable).getByRole('columnheader', {
      name: `Average drive energy consumption (${efficiencyUnit})`,
    })).toHaveAttribute('scope', 'col');
    expect(within(distributionTable).getByRole('columnheader', {
      name: 'Contributing drives',
    })).toHaveAttribute('scope', 'col');
    expect(model.speedVsEff[0]).toEqual({ speed: miles ? 45 : 72, efficiency: miles ? 241 : 150 });
    expect(model.tempVsEff[0]).toEqual({ temp: miles ? 77 : 25, efficiency: miles ? 241 : 150 });
    expect(bodyCells(speedTable)).toEqual(model.speedVsEff.map(d => [measurement(d.speed), measurement(d.efficiency)]));
    expect(bodyCells(tempTable)).toEqual(model.tempVsEff.map(d => [measurement(d.temp), measurement(d.efficiency)]));
    expect(bodyCells(trendTable)).toEqual(model.dailyTrend.map(d =>
      [d.date, measurement(d.efficiency), d.distance == null ? '—' : measurement(d.distance)]));
    expect(bodyCells(trendTable)).toHaveLength(30);
    expect(bodyCells(speedTable)).toHaveLength(40);
    expect(bodyCells(tempTable)).toHaveLength(40);
    expect(bodyCells(distributionTable)).toEqual(model.speedDist.map(d =>
      [d.range, measurement(d.avgEff), String(d.count)]));
    expect(screen.getByRole('img', { name: 'Speed versus efficiency scatter plot' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Temperature versus efficiency scatter plot' })).toBeInTheDocument();
  });

  it('retains per-drive table values through a refresh failure without replacing the figure', () => {
    const units = fakeUnits();
    const rows = Array.from({ length: 4 }, (_, id) => fakeDrive({ id, avgSpeedMps: id * 10 }));
    const model = buildEfficiencyModel(rows, units.unitPrefs);
    const content = (error?: Error) => <EfficiencyScatter kind="speed" model={model} units={units}
      source={{ state: deriveDataState(fakeQuery(rows, { error })), loading: false, malformed: false }} />;
    const view = render(content(), { wrapper: Providers });
    const table = screen.getByRole('table', { name: 'Speed vs efficiency — data table' });
    const figure = screen.getByRole('figure', { name: 'Speed vs efficiency' });
    const originalCells = bodyCells(table);
    // A measured zero is preserved, not a missing marker.
    expect(originalCells[0][0]).toBe(measurement(0));
    view.rerender(content(new Error('refresh failed')));
    expect(screen.getByRole('figure', { name: 'Speed vs efficiency' })).toBe(figure);
    expect(screen.getByRole('table', { name: 'Speed vs efficiency — data table' })).toBe(table);
    expect(bodyCells(table)).toEqual(originalCells);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });
});
