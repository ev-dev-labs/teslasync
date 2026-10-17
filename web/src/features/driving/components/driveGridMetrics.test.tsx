import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Drive } from '@/types/driving';
import { driveAverageSpeed, driveBattery } from './driveGridMetrics';
import { DriveGridMetric, metricBand } from './DriveGridMetric';
import { compactDriveValueSelection, driveColumnValue, driveValueKey, parseDriveValueSelections } from './driveGridValues';

const drive: Drive = {
  id: 1, vehicleId: 7, startTs: '2026-08-25T08:00:00Z', endTs: '2026-08-25T08:30:00Z',
  durationS: 1800, distanceM: 30000, startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: 80, endBatteryPct: 70, energyUsedWh: 6000, regenEnergyWh: 1000,
  avgSpeedMps: null, maxSpeedMps: 30, avgPowerW: 12000,
  outsideTempAvgC: 20, insideTempAvgC: null, score: 90, endedStatus: 'completed',
  createdAt: '2026-08-25T08:00:00Z', updatedAt: '2026-08-25T08:30:00Z',
};

describe('drive grid metrics', () => {
  it('uses established battery and SI efficiency thresholds, not display-unit thresholds', () => {
    expect(metricBand(70, 'battery')).toBe('good');
    expect(metricBand(60, 'battery')).toBe('warning');
    expect(metricBand(25, 'battery')).toBe('critical');
    expect(metricBand(159, 'efficiency')).toBe('good');
    expect(metricBand(160, 'efficiency')).toBe('info');
    expect(metricBand(190, 'efficiency')).toBe('warning');
    expect(metricBand(220, 'efficiency')).toBe('critical');
  });

  describe('canonical drive filter values', () => {
    it('preserves all versus none and accepts compact exclusions', () => {
      expect(parseDriveValueSelections('')).toEqual({ selections: {}, invalid: false });
      expect(parseDriveValueSelections('{"distance":[]}')).toEqual({ selections: { distance: [] }, invalid: false });
      expect(parseDriveValueSelections('{"distance":{"excluded":["30000"]}}')).toEqual({
        selections: { distance: { excluded: ['30000'] } }, invalid: false,
      });
    });

    it.each(['{broken', 'null', '[]', '{"bogus":[]}', '{"distance":42}', '{"distance":[42]}',
      '{"distance":["not-json"]}', '{"distance":["{}"]}', '{"distance":{"excluded":[],"extra":1}}'])('rejects invalid saved filters: %s', (raw) => {
      expect(parseDriveValueSelections(raw).invalid).toBe(true);
    });

    it('stores a small exclusion rather than hundreds of checked keys', () => {
      const available = Array.from({ length: 1000 }, (_, index) => String(index));
      const selected = available.slice(1);
      expect(compactDriveValueSelection(selected, available)).toEqual({ excluded: ['0'] });
      expect(compactDriveValueSelection([], available)).toEqual([]);
      expect(compactDriveValueSelection(['9999'], available)).toEqual(['9999']);
    });

    it('uses raw SI keys and keeps missing readings distinct from zero', () => {
      expect(driveValueKey(driveColumnValue(drive, 'distance', new Map(), new Set()))).toBe('30000');
      expect(driveValueKey(driveColumnValue({ ...drive, regenEnergyWh: null }, 'regen', new Map(), new Set()))).toBe('null');
      expect(driveValueKey(driveColumnValue({ ...drive, regenEnergyWh: 0 }, 'regen', new Map(), new Set()))).toBe('0');
      expect(driveColumnValue(drive, 'batteryUsed', new Map(), new Set())).toBe(10);
    });
  });

  it('uses the fixed score thresholds', () => {
    expect(metricBand(90, 'score')).toBe('good');
    expect(metricBand(70, 'score')).toBe('warning');
    expect(metricBand(69, 'score')).toBe('critical');
  });
  it('uses start minus end for battery used and preserves battery gains', () => {
    expect(driveBattery(drive)).toEqual({ start: 80, end: 70, used: 10 });
    expect(driveBattery({ ...drive, endBatteryPct: 85 }).used).toBe(-5);
  });

  it('preserves partial readings without inventing battery use', () => {
    expect(driveBattery({ ...drive, endBatteryPct: null })).toEqual({ start: 80, end: null, used: null });
    expect(driveBattery({ ...drive, startBatteryPct: 0, endBatteryPct: 0 }))
      .toEqual({ start: null, end: null, used: null });
  });

  it('derives average speed only with a valid duration', () => {
    expect(driveAverageSpeed(drive)).toBeCloseTo(16.6667);
    expect(driveAverageSpeed({ ...drive, durationS: 0 })).toBeNull();
    expect(driveAverageSpeed({ ...drive, avgSpeedMps: 0 })).toBe(0);
  });

  it('fills the battery silhouette from the actual charge out of 100', () => {
    const { container } = render(
      <DriveGridMetric value={70} kind="battery" scaleLabel="Battery">70.00</DriveGridMetric>,
    );
    expect(Number(container.querySelector('[data-fill]')?.getAttribute('width'))).toBeCloseTo(15.4);
    expect(screen.getByText('70.00')).toBeInTheDocument();
  });

  it.each([[120, 5], [150, 4], [170, 3], [200, 2], [250, 1]])('represents the SI grade of %s with %s active segments', (value, count) => {
    const { container } = render(<DriveGridMetric value={value} kind="efficiency" scaleLabel="Efficiency">{value}</DriveGridMetric>);
    expect(container.querySelectorAll('[data-fill]')).toHaveLength(count);
  });

  it('renders unknown readings as unknown instead of a zero-valued bar', () => {
    const { container } = render(
      <DriveGridMetric value={null} kind="battery" scaleLabel="Battery">0</DriveGridMetric>,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });
});
