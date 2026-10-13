import { cloneElement, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_COLORS } from '@/components/charts';
import { formatTime } from '@/lib/dateFormat';
import type { PowerwallInput, SlotResult } from '../lib/types';
import { PowerwallTrajectoryChart } from './PowerwallTrajectoryChart';

// jsdom has no layout; fix only the responsive viewport, keeping the real
// chart, SVG series, axes, tooltip, frame and accessible table.
vi.mock('@/components/charts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 800, height: 260 }),
}));

const originalFullscreen = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');
const originalFullscreenEnabled = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

const powerwall: PowerwallInput = {
  capacityWh: 13500,
  currentSocPct: 37.26,
  reservePct: 25.55,
  maxChargePowerW: 5000,
  maxDischargePowerW: 5000,
  roundTripEfficiency: 0.9,
};

function slot(slotIndex: number, startIso: string, batterySocPct: number): SlotResult {
  return {
    slotIndex,
    startIso,
    batterySocPct,
    solarW: 1750,
    loadW: 750,
    unmetLoadW: 0,
    vehicleChargeW: 0,
    vehiclePowerW: {},
    batteryChargeW: 1000,
    batteryDischargeW: 0,
    batteryPowerW: 1000,
    gridImportW: 0,
    gridExportW: 0,
    curtailedW: 0,
    importPricePerKwh: 0.12,
    exportPricePerKwh: 0.03,
    slotCost: 0,
  };
}

const slots = [
  slot(0, '2026-10-12T08:00:00Z', 0),
  slot(1, '2026-10-12T08:15:00Z', 0.06),
  slot(2, '2026-10-12T08:30:00Z', 37.26),
  slot(3, '2026-10-12T08:45:00Z', 100),
];

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  })));
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalFullscreen) {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', originalFullscreen);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  }
  if (originalFullscreenEnabled) {
    Object.defineProperty(document, 'fullscreenEnabled', originalFullscreenEnabled);
  } else {
    Reflect.deleteProperty(document, 'fullscreenEnabled');
  }
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
  } else {
    Reflect.deleteProperty(URL, 'createObjectURL');
  }
  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
  } else {
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
});

describe('PowerwallTrajectoryChart restrained area paint', () => {
  it('renders eight-percent area tint with the original series, reserve and formatted axes', async () => {
    const { container } = render(<PowerwallTrajectoryChart slots={slots} powerwall={powerwall} />);
    await waitFor(() => {
      expect(container.querySelector('.recharts-area-area')).toHaveAttribute('fill-opacity', '0.08');
    });
    expect(container.querySelectorAll('.recharts-area-area')).toHaveLength(1);
    expect(container.querySelector('.recharts-area-area')).toHaveAttribute('fill', CHART_COLORS[3]);
    expect(container.querySelector('.recharts-area-curve')).toHaveAttribute('stroke', CHART_COLORS[3]);
    expect(container.querySelector('.recharts-area-curve')).toHaveAttribute('stroke-width', '2');
    expect(container.querySelector('.recharts-reference-line-line')).toHaveAttribute('stroke', CHART_COLORS[4]);
    expect(container.querySelector('.recharts-reference-line-line')).toHaveAttribute('stroke-dasharray', '4 4');
    expect(screen.getByText('Reserve floor').closest('text')).toHaveAttribute('fill', CHART_COLORS[4]);
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('0%');
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('100%');
    expect(container.querySelector('.recharts-xAxis')).toHaveTextContent(formatTime(slots[0].startIso));
    // The figure is named by its title; the viewport carries the chart description.
    expect(screen.getByRole('figure', { name: 'Powerwall trajectory' })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: 'Powerwall state of charge over time, with reserve floor reference line',
    })).toBeInTheDocument();
    expect(screen.getAllByText('Projected state of charge, with the backup reserve floor')).toHaveLength(2);
    expect(container.querySelector('.recharts-tooltip-wrapper')).toBeInTheDocument();
  });

  it('retains every ordered timestamp and rounded SOC reading in the accessible table and CSV', async () => {
    const createUrl = vi.fn<(blob: Blob) => string>(() => 'blob:powerwall-test');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const originalSlots = structuredClone(slots);
    const originalPowerwall = structuredClone(powerwall);
    render(<PowerwallTrajectoryChart slots={slots} powerwall={powerwall} />);
    const table = screen.getByRole('table', { name: 'Powerwall trajectory — data table' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual(['Time', 'State of charge']);
    expect(within(table).getAllByRole('row').slice(1).map((row) =>
      within(row).getAllByRole('cell').map((cell) => cell.textContent)))
      .toEqual([
        ['2026-10-12T08:00:00Z', '0'],
        ['2026-10-12T08:15:00Z', '0.1'],
        ['2026-10-12T08:30:00Z', '37.3'],
        ['2026-10-12T08:45:00Z', '100'],
      ]);
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(createUrl.mock.calls[0][0]);
    });
    expect(csv.replace(/^\ufeff/, '')).toBe(
      'time,socPct\r\n2026-10-12T08:00:00Z,0\r\n2026-10-12T08:15:00Z,0.1\r\n'
      + '2026-10-12T08:30:00Z,37.3\r\n2026-10-12T08:45:00Z,100',
    );
    expect(slots).toEqual(originalSlots);
    expect(powerwall).toEqual(originalPowerwall);
  });

  it('keeps the unmodeled battery explanation and shell without inventing a zero trajectory', () => {
    const { container } = render(<PowerwallTrajectoryChart slots={slots} powerwall={null} />);
    expect(screen.getByRole('heading', { name: 'Powerwall trajectory' })).toBeInTheDocument();
    expect(screen.getByText(
      'No home battery is modeled in this scenario. Enable it under scenario & assumptions.',
    )).toBeInTheDocument();
    expect(container.querySelector('.recharts-surface')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export chart' })).not.toBeInTheDocument();
  });

  it('keeps the empty modeled horizon separate from an unmodeled battery and never fabricates points', () => {
    const { container } = render(<PowerwallTrajectoryChart slots={[]} powerwall={powerwall} />);
    expect(screen.getByRole('heading', { name: 'Powerwall trajectory' })).toBeInTheDocument();
    expect(screen.getAllByText('Projected state of charge, with the backup reserve floor')).toHaveLength(2);
    expect(screen.queryByText(
      'No home battery is modeled in this scenario. Enable it under scenario & assumptions.',
    )).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-area-area')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export chart' })).not.toBeInTheDocument();
  });
});
