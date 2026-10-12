import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_COLORS, Line } from '@/components/charts';
import { formatTime } from '@/lib/dateFormat';
import { EnergyFlowChart } from './EnergyFlowChart';
import type { SlotResult } from '../lib/types';

const { downloadCSV } = vi.hoisted(() => ({
  downloadCSV: vi.fn<(filename: string, csv: string) => void>(),
}));

vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV,
}));

const slots: SlotResult[] = [
  {
    slotIndex: 0, startIso: '2026-10-12T12:00:00Z', solarW: 4000.4, loadW: 1250.6,
    unmetLoadW: 0, vehicleChargeW: 2000.4, vehiclePowerW: { vehicle: 2000.4 },
    batteryChargeW: 749.4, batteryDischargeW: 0, batteryPowerW: 749.4,
    batterySocPct: 51, gridImportW: 0, gridExportW: 0, curtailedW: 0,
    importPricePerKwh: 0.25, exportPricePerKwh: 0.08, slotCost: 0,
  },
  {
    slotIndex: 1, startIso: '2026-10-12T12:15:00Z', solarW: 1000.6, loadW: 2200.4,
    unmetLoadW: 0, vehicleChargeW: 999.6, vehiclePowerW: { vehicle: 999.6 },
    batteryChargeW: 0, batteryDischargeW: 500.6, batteryPowerW: -500.6,
    batterySocPct: 50, gridImportW: 1698.6, gridExportW: 300.6, curtailedW: 0,
    importPricePerKwh: 0.25, exportPricePerKwh: 0.08, slotCost: 0.1,
  },
  {
    slotIndex: 2, startIso: '2026-10-12T12:30:00Z', solarW: 0, loadW: 0,
    unmetLoadW: 0, vehicleChargeW: 0, vehiclePowerW: {},
    batteryChargeW: 0, batteryDischargeW: 0, batteryPowerW: 0,
    batterySocPct: 50, gridImportW: 0, gridExportW: 0, curtailedW: 0,
    importPricePerKwh: 0.25, exportPricePerKwh: 0.08, slotCost: 0,
  },
];

const labels = [
  'Solar', 'Household load', 'Vehicle charging', 'Powerwall (+charge/-discharge)',
  'Grid import', 'Grid export (shown negative)',
];

const lineDefaults = Line.defaultProps;
const fullscreenSupport = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');

function LocationEvidence() {
  return <output aria-label="Chart URL">{useLocation().search}</output>;
}

function mount(source = slots) {
  return render(
    <MemoryRouter>
      <EnergyFlowChart slots={source} slotMinutes={15} />
      <LocationEvidence />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  downloadCSV.mockClear();
  // jsdom has no layout; provide dimensions only, keeping the real frame,
  // Recharts SVG, legend, tooltip, table and export serialization mounted.
  vi.spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 960, 320));
  // Recharts entry animation requires native SVG path measurement. Render
  // its real static paths in jsdom rather than asserting an animation frame.
  Line.defaultProps = { ...lineDefaults, isAnimationActive: false };
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Line.defaultProps = lineDefaults;
  if (fullscreenSupport) Object.defineProperty(document, 'fullscreenEnabled', fullscreenSupport);
  else Reflect.deleteProperty(document, 'fullscreenEnabled');
});

describe('EnergyFlowChart restrained paint', () => {
  it('renders an eight percent solar tint and one pixel grid references while preserving series paint and weights', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(5);
    }, { timeout: 4000 });
    expect(container.querySelector('.recharts-area-area'))
      .toHaveAttribute('fill-opacity', '0.08');
    expect(container.querySelector('.recharts-area-area')).toHaveAttribute('fill', CHART_COLORS[2]);
    expect(container.querySelector('.recharts-area-curve')).toHaveAttribute('stroke', CHART_COLORS[2]);
    expect(container.querySelector('.recharts-area-curve')).toHaveAttribute('stroke-width', '2');
    const lines = [...container.querySelectorAll('.recharts-line-curve')];
    expect(lines.map(line => line.getAttribute('stroke'))).toEqual([
      CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[3], CHART_COLORS[4], CHART_COLORS[5],
    ]);
    expect(lines.map(line => line.getAttribute('stroke-width'))).toEqual(['2', '2', '2', '1', '1']);
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line-curve')[2])
        .toHaveAttribute('stroke-dasharray', '4 2');
    }, { timeout: 4000 });
    expect(container.querySelector('.recharts-reference-line-line'))
      .toHaveAttribute('stroke', 'var(--border-strong)');
    expect(container.querySelectorAll('.recharts-xAxis')).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('keeps all slot rows in watts with battery charge and discharge signs and negative exports', () => {
    mount();
    const table = screen.getByRole('table', { hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true });
    expect(within(rows[0]).getAllByRole('columnheader', { hidden: true })
      .map(cell => cell.textContent)).toEqual(['Time', ...labels]);
    expect(rows.slice(1).map(row =>
      within(row).getAllByRole('cell', { hidden: true }).map(cell => cell.textContent),
    )).toEqual([
      ['2026-10-12T12:00:00Z', '4000', '1251', '2000', '749', '0', '0'],
      ['2026-10-12T12:15:00Z', '1001', '2200', '1000', '-501', '1699', '-301'],
      ['2026-10-12T12:30:00Z', '0', '0', '0', '0', '0', '0'],
    ]);
    expect(screen.getByRole('button', {
      name: 'Read full description for Energy flow schedule',
    })).toHaveAccessibleDescription(
      'Solar, household load, vehicle charging, battery, and grid — per 15-minute slot',
    );
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeEnabled();
  });

  it('preserves the time and power formatters and the shared six series tooltip', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('.recharts-xAxis')).toHaveTextContent(
        formatTime(slots[0].startIso).replace(/\s/g, ''),
      );
      expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('kW');
    });
    const chart = container.querySelector<HTMLElement>('.recharts-wrapper')!;
    fireEvent.mouseMove(chart, { clientX: 90, clientY: 100 });
    const tooltip = await within(chart).findByRole('tooltip');
    for (const label of labels) expect(tooltip).toHaveTextContent(`${label}:`);
    expect(tooltip).toHaveTextContent('4,000');
    expect(tooltip).toHaveTextContent('1,251');
    expect(tooltip).toHaveTextContent('749');
  });

  it('keeps the chart key and complete CSV when a retained series is hidden and restored', async () => {
    const { container } = mount();
    const toggle = screen.getByRole('button', { name: 'Grid export (shown negative)' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Chart URL')).toHaveTextContent(
      'hidden_home-energy-flow-schedule=gridExportW',
    );
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('-301');
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/i }));
    expect(downloadCSV).toHaveBeenCalledTimes(1);
    expect(downloadCSV.mock.calls[0][1]).toBe(
      'time,solarW,loadW,vehicleChargeW,batteryPowerW,gridImportW,gridExportW\r\n' +
      '2026-10-12T12:00:00Z,4000,1251,2000,749,0,0\r\n' +
      '2026-10-12T12:15:00Z,1001,2200,1000,-501,1699,-301\r\n' +
      '2026-10-12T12:30:00Z,0,0,0,0,0,0',
    );
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Chart URL').textContent).toBe('');
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(5);
    }, { timeout: 4000 });
  });

  it('retains the empty chart shell without fabricating measurements or export actions', () => {
    const { container } = mount([]);
    expect(screen.getByRole('heading', { name: 'Energy flow schedule' })).toBeInTheDocument();
    expect(screen.getByRole('figure')).toHaveAccessibleName('Energy flow schedule');
    expect(screen.getByRole('figure')).toHaveAttribute('data-chart-state', 'empty');
    expect(container.querySelector('.recharts-surface')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export chart' })).toBeNull();
    expect(screen.queryByRole('table', { hidden: true })).toBeNull();
    expect(downloadCSV).not.toHaveBeenCalled();
  });
});
