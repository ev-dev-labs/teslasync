import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chartTokens } from '@/lib/tokens';
import type { GridLimits, SlotResult } from '../lib/types';
import { TariffConstraintHeatmap } from './TariffConstraintHeatmap';

const labels = ['Import tariff', 'Grid import %', 'Grid export %', 'Vehicle charging', 'Powerwall SoC'];
const grid: GridLimits = { maxImportW: 2000, maxExportW: 4000 };
const preferences = vi.hoisted(() => ({ currency: '$', tariffLabel: 'Import tariff' }));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      currency_symbol: preferences.currency,
      locale: 'en-US',
      decimal_precision: 2,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => key === 'homeEnergy.heatmap.tariff' ? preferences.tariffLabel : fallback,
  }),
}));

function slot(index: number, overrides: Partial<SlotResult> = {}): SlotResult {
  return {
    slotIndex: index + 7,
    startIso: new Date(2026, 9, 12, 8, index * 15).toISOString(),
    solarW: 3150,
    loadW: 900,
    unmetLoadW: 0,
    vehicleChargeW: 1500,
    vehiclePowerW: { 'vehicle-a': 1500 },
    batteryChargeW: 0,
    batteryDischargeW: 750,
    batteryPowerW: -750,
    batterySocPct: 37.6,
    gridImportW: 1500,
    gridExportW: 250,
    curtailedW: 0,
    importPricePerKwh: 0.125,
    exportPricePerKwh: 0.04,
    slotCost: 0.043,
    ...overrides,
  };
}

function time(value: SlotResult, end = false, slotMinutes = 15): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
    .format(new Date(Date.parse(value.startIso) + (end ? slotMinutes * 60_000 : 0)));
}

function color(bucket: number): string {
  return `color-mix(in srgb, ${chartTokens.series[0]} ${[4, 15, 40, 55, 75][bucket]}%, transparent)`;
}

function expectBucket(button: HTMLElement, bucket: number) {
  const fill = button.querySelector<HTMLElement>('span[aria-hidden="true"]');
  expect(fill).not.toBeNull();
  expect(fill?.style.backgroundColor.replace(/\s/g, '')).toBe(color(bucket).replace(/\s/g, ''));
}

beforeEach(() => {
  preferences.currency = '$';
  preferences.tariffLabel = 'Import tariff';
});

describe('TariffConstraintHeatmap', () => {
  it('labels battery SOC at a custom interval end while keeping flow cells at the actual start', async () => {
    const value = slot(0, { startIso: '2026-10-12T23:45:00Z', batterySocPct: 62.3 });
    render(<TariffConstraintHeatmap slots={[value]} grid={grid} hasPowerwall slotMinutes={30} />);
    for (const label of labels.slice(0, 4)) {
      expect(within(screen.getByRole('group', { name: label })).getByRole('button'))
        .toHaveAccessibleName(new RegExp(`^${label}: ${time(value)} — `));
    }
    const battery = screen.getByRole('button', { name: `Powerwall SoC: ${time(value, true, 30)} — 62%` });
    expect(battery).toHaveAttribute('title', `${time(value, true, 30)} — 62%`);
    await userEvent.setup().click(battery);
    expect(document.getElementById(battery.getAttribute('aria-describedby') ?? ''))
      .toHaveTextContent(`Powerwall SoC: ${time(value, true, 30)} — 62%`);
  });

  it.each([
    { name: 'four rows without Powerwall', hasPowerwall: false, rowCount: 4 },
    { name: 'five rows with Powerwall', hasPowerwall: true, rowCount: 5 },
  ])('preserves every horizon slot in $name', ({ hasPowerwall, rowCount }) => {
    const slots = Array.from({ length: 96 }, (_, index) => slot(index));
    const snapshot = structuredClone(slots);
    render(<TariffConstraintHeatmap slots={slots} grid={grid} hasPowerwall={hasPowerwall} />);

    expect(screen.getByRole('heading', { name: 'Tariff & constraint heatmap' })).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(rowCount);
    expect(screen.getAllByRole('button')).toHaveLength(96 * rowCount);
    labels.slice(0, rowCount).forEach((label) => {
      const buttons = within(screen.getByRole('group', { name: label })).getAllByRole('button');
      expect(buttons).toHaveLength(96);
      buttons.forEach((button, index) => {
        expect(button).toHaveAccessibleName(new RegExp(`^${label}: ${time(slots[index], label === 'Powerwall SoC')} — `));
        expect(button).toHaveAttribute('type', 'button');
        expect(button).not.toBeDisabled();
      });
    });
    expect(screen.queryByRole('group', { name: 'Powerwall SoC' }) !== null).toBe(hasPowerwall);
    expect(slots).toEqual(snapshot);
  });

  it('keeps exact five bucket thresholds and neutral nonfinite ratios', () => {
    const ratios = [NaN, -Infinity, Infinity, -1, 0, 0.000001, 0.249999, 0.25, 0.499999, 0.5, 0.749999, 0.75, 1, 2];
    const expected = [0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4];
    const slots = ratios.map((ratio, index) => slot(index, { gridImportW: ratio * 2000 }));
    render(<TariffConstraintHeatmap slots={slots} grid={grid} hasPowerwall={false} />);

    const buttons = within(screen.getByRole('group', { name: 'Grid import %' })).getAllByRole('button');
    expect(buttons).toHaveLength(ratios.length);
    buttons.forEach((button, index) => expectBucket(button, expected[index]));
    expect(buttons[0]).toHaveAccessibleName(`Grid import %: ${time(slots[0])} — —`);
    expect(buttons[4]).toHaveAccessibleName(`Grid import %: ${time(slots[4])} — 0 kW`);
    expect(buttons[13]).toHaveAccessibleName(`Grid import %: ${time(slots[13])} — 4 kW`);
  });

  it('preserves tariff vehicle grid and SoC normalization independently', () => {
    const slots = [
      slot(0, { importPricePerKwh: 0, gridImportW: 500, gridExportW: 500, vehicleChargeW: 500, batterySocPct: 0 }),
      slot(1, { importPricePerKwh: 0.25, gridImportW: 1000, gridExportW: 1000, vehicleChargeW: 1000, batterySocPct: 25 }),
      slot(2, { importPricePerKwh: 1, gridImportW: 2000, gridExportW: 2000, vehicleChargeW: 2000, batterySocPct: 75 }),
    ];
    render(<TariffConstraintHeatmap slots={slots} grid={grid} hasPowerwall />);
    const buckets = [[0, 2, 4], [2, 3, 4], [1, 2, 3], [2, 3, 4], [0, 2, 4]];
    labels.forEach((label, rowIndex) => {
      const buttons = within(screen.getByRole('group', { name: label })).getAllByRole('button');
      buttons.forEach((button, index) => expectBucket(button, buckets[rowIndex][index]));
    });
    expect(screen.getByRole('button', { name: `Import tariff: ${time(slots[1])} — $0.25/kWh` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Powerwall SoC: ${time(slots[2], true)} — 75%` })).toBeInTheDocument();
  });

  it('retains zero tariff and vehicle floors and nonpositive grid caps without inventing values', () => {
    const value = slot(0, { importPricePerKwh: 0, vehicleChargeW: 0 });
    render(<TariffConstraintHeatmap slots={[value]} grid={{ maxImportW: 0, maxExportW: -1 }} hasPowerwall={false} />);
    labels.slice(0, 4).forEach((label) => {
      expectBucket(within(screen.getByRole('group', { name: label })).getByRole('button'), 0);
    });
    expect(screen.getByRole('button', { name: `Grid import %: ${time(value)} — 1.5 kW` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Grid export %: ${time(value)} — 0.25 kW` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Vehicle charging: ${time(value)} — 0 kW` })).toBeInTheDocument();
  });

  it('exposes exact time and values through keyboard focus activation and persistent details', async () => {
    const user = userEvent.setup();
    const slots = [slot(0), slot(1, { gridImportW: 0, vehicleChargeW: 3200, batterySocPct: 0 })];
    render(<TariffConstraintHeatmap slots={slots} grid={grid} hasPowerwall />);
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      await user.tab();
      expect(button).toHaveFocus();
      const detail = document.getElementById(button.getAttribute('aria-describedby') ?? '');
      expect(detail).not.toBeNull();
      expect(detail).toHaveTextContent(button.getAttribute('aria-label') ?? '');
      await user.keyboard('{Enter}');
      expect(button).toHaveFocus();
      expect(detail).toHaveTextContent(button.getAttribute('aria-label') ?? '');
    }
    const last = screen.getByRole('button', { name: `Powerwall SoC: ${time(slots[1], true)} — 0%` });
    expect(last).toHaveFocus();
    await user.keyboard(' ');
    expect(document.getElementById(last.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      `Powerwall SoC: ${time(slots[1], true)} — 0%`,
    );
    await user.tab({ shift: true });
    expect(buttons[buttons.length - 2]).toHaveFocus();
  });

  it('keeps long translated labels untruncated and pointer details readable after hover', async () => {
    preferences.tariffLabel = 'Import tariff including the complete translated price classification and units';
    const user = userEvent.setup();
    const slots = [slot(0), slot(1, { importPricePerKwh: 0.35 })];
    render(<TariffConstraintHeatmap slots={slots} grid={grid} hasPowerwall={false} />);
    const label = screen.getByText(preferences.tariffLabel);
    expect(label).toHaveClass('break-words', 'whitespace-normal');
    expect(label).not.toHaveClass('truncate');
    const button = screen.getByRole('button', { name: `${preferences.tariffLabel}: ${time(slots[1])} — $0.35/kWh` });
    await user.hover(button);
    const detail = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(detail).toHaveTextContent(`${preferences.tariffLabel}: ${time(slots[1])} — $0.35/kWh`);
    await user.unhover(button);
    expect(detail).toHaveTextContent(`${preferences.tariffLabel}: ${time(slots[1])} — $0.35/kWh`);
    expect(button).toHaveClass('h-11', 'w-11', 'md:h-6', 'md:w-6');
  });

  it('updates accessible values using existing display preferences without mutating raw watts', () => {
    const value = slot(0);
    const { rerender } = render(<TariffConstraintHeatmap slots={[value]} grid={grid} hasPowerwall />);
    expect(screen.getByRole('button', { name: `Grid import %: ${time(value)} — 1.5 kW` })).toBeInTheDocument();
    preferences.currency = '€';
    rerender(<TariffConstraintHeatmap slots={[value]} grid={grid} hasPowerwall />);
    expect(screen.getByRole('button', { name: `Grid import %: ${time(value)} — 1.5 kW` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Import tariff: ${time(value)} — €0.13/kWh` })).toBeInTheDocument();
    expect(value.gridImportW).toBe(1500);
    expect(value.batteryDischargeW).toBe(750);
    expect(value.importPricePerKwh).toBe(0.125);
  });

  it('keeps details on real current slots when the horizon shrinks or Powerwall is removed', async () => {
    const user = userEvent.setup();
    const slots = [slot(0), slot(1, { batterySocPct: 80 })];
    const { rerender } = render(<TariffConstraintHeatmap slots={slots} grid={grid} hasPowerwall />);
    const powerwall = screen.getByRole('button', { name: `Powerwall SoC: ${time(slots[1], true)} — 80%` });
    await user.click(powerwall);
    const detailId = powerwall.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(detailId)).toHaveTextContent(`Powerwall SoC: ${time(slots[1], true)} — 80%`);

    const current = slot(2, { importPricePerKwh: 0.3 });
    rerender(<TariffConstraintHeatmap slots={[current]} grid={grid} hasPowerwall={false} />);
    expect(screen.queryByRole('group', { name: 'Powerwall SoC' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(document.getElementById(detailId)).toHaveTextContent(`Import tariff: ${time(current)} — $0.30/kWh`);
    expect(document.getElementById(detailId)).not.toHaveTextContent('80%');
  });

  it('uses the same restrained five colors for the legend and keeps the empty message', () => {
    const { container } = render(<TariffConstraintHeatmap slots={[]} grid={grid} hasPowerwall />);
    expect(screen.getByText('No plan slots to display yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByText('Less')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    const swatches = container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]');
    expect(swatches).toHaveLength(5);
    swatches.forEach((swatch, index) => {
      expect(swatch.style.backgroundColor.replace(/\s/g, '')).toBe(color(index).replace(/\s/g, ''));
    });
  });
});
