import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DrivePreview } from './DrivePreview';
import type { Drive } from '@/types/driving';

const drive: Drive = {
  id: 42, vehicleId: 7, startTs: '2026-10-01T12:00:00Z', endTs: '2026-10-01T13:00:00Z',
  durationS: 3600, distanceM: 40_000, startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: null, endBatteryPct: 0, energyUsedWh: null, regenEnergyWh: null,
  avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
  outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: 'completed',
  createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T13:00:00Z',
};

function renderPreview(value: Drive = drive) {
  const onClose = vi.fn();
  const onOpenDetails = vi.fn();
  const formatEnergy = vi.fn((energy: number) => `${energy / 1000} kWh`);
  render(
    <MemoryRouter>
      <DrivePreview drive={value} onClose={onClose} onOpenDetails={onOpenDetails}
        timezone="UTC" from="2026-10-01" to="2026-10-01"
        toDistanceDisplay={(meters) => meters / 1000} toEfficiencyDisplay={(intensity) => intensity}
        formatEnergy={formatEnergy} distanceUnit="km" efficiencyUnit="Wh/km" />
    </MemoryRouter>,
  );
  return { onClose, onOpenDetails, formatEnergy };
}

describe('DrivePreview', () => {
  it('preserves all evidence fields, unknown energy and a measured zero battery endpoint', () => {
    const { formatEnergy } = renderPreview();
    expect(screen.getByRole('dialog', { name: 'Home → Office' })).toBeInTheDocument();
    for (const label of ['Duration', 'Distance', 'Energy used', 'Battery change', 'Energy intensity', 'Efficiency grade']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(formatEnergy).not.toHaveBeenCalled();
    expect(screen.getByText(/— → 0/)).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('keeps all seven related destinations and the prepared date context', () => {
    renderPreview();
    expect(screen.getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/7');
    expect(screen.getByRole('link', { name: 'Charging sessions' }).getAttribute('href')).toContain('from=2026-10-01');
    expect(screen.getByRole('link', { name: 'Start location' }).getAttribute('href')).toContain('q=Home');
    expect(screen.getByRole('link', { name: 'Destination' }).getAttribute('href')).toContain('q=Office');
    expect(screen.getByRole('link', { name: 'Alerts' }).getAttribute('href')).toContain('/notifications/inbox');
    expect(screen.getByRole('link', { name: 'Service history' })).toHaveAttribute('href', '/maintenance');
    expect(screen.getByRole('link', { name: 'Telemetry evidence' }).getAttribute('href')).toContain('VehicleSpeed');
  });

  it('closes before opening the exact drive identity and does not mutate data', () => {
    const { onClose, onOpenDetails } = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Open drive details' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenDetails).toHaveBeenCalledWith(42);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onOpenDetails.mock.invocationCallOrder[0]);
  });

  it('does not call the energy formatter for a nonfinite reading', () => {
    const { formatEnergy } = renderPreview({ ...drive, energyUsedWh: Number.POSITIVE_INFINITY });
    expect(formatEnergy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });

  it('preserves a measured zero energy reading', () => {
    const { formatEnergy } = renderPreview({ ...drive, energyUsedWh: 0 });
    expect(formatEnergy).toHaveBeenCalledWith(0);
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
  });
});
