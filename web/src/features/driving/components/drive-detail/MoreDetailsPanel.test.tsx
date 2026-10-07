import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MoreDetailsPanel } from './MoreDetailsPanel';
import { driveFixture, pointFixture, statsFixture } from './detailTestFixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
const prefs = vi.hoisted(() => ({ distance: 'km' }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: prefs, formatEnergy: (wh: number) => `${wh / 1000} kWh` }),
}));

const value = (label: string) => within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getAllByRole('cell')[0].textContent;
beforeEach(() => { prefs.distance = 'km'; });

describe('Energy and range evidence', () => {
  it('keeps every evidence row and its source in a semantic matrix', () => {
    render(<MoreDetailsPanel drive={driveFixture()} stats={statsFixture()} />);
    expect(screen.getByRole('table', { name: 'Energy and range evidence' })).toBeInTheDocument();
    for (const label of ['Energy consumed', 'Energy recovered', 'Odometer (from → to)', 'Range (start → end)', 'Range used', 'Battery used']) {
      expect(screen.getByRole('rowheader', { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Persisted drive aggregate')).toHaveLength(2);
    expect(value('Energy consumed')).toBe('8 kWh');
    expect(value('Energy recovered')).toBe('1 kWh');
  });

  it('does not double-subtract regen or repeat overview, power, elevation and temperature metrics', () => {
    render(<MoreDetailsPanel drive={driveFixture()} stats={statsFixture()} />);
    expect(screen.queryByRole('rowheader', { name: /net|consumption|power|temperature|speed|elevation/i })).toBeNull();
    expect(screen.queryByText('7 kWh')).toBeNull();
    expect(screen.getByText(/No additional net-energy total is inferred/)).toBeInTheDocument();
  });

  it('retains a signed persisted energy value without absolute-value coercion', () => {
    render(<MoreDetailsPanel drive={driveFixture({ energyUsedWh: -100 })} stats={statsFixture()} />);
    expect(value('Energy consumed')).toBe('-0.1 kWh');
  });

  it('does not invent energy from derived zero defaults when aggregate and power observations are missing', () => {
    render(<MoreDetailsPanel drive={driveFixture({ energyUsedWh: null, regenEnergyWh: null, avgPowerW: null })} stats={statsFixture()} />);
    expect(value('Energy consumed')).toBe('—');
    expect(value('Energy recovered')).toBe('—');
  });

  it('labels average-power estimates rather than calling them metered energy', () => {
    render(<MoreDetailsPanel drive={driveFixture({ energyUsedWh: null, regenEnergyWh: null })} stats={statsFixture()} />);
    expect(value('Energy consumed')).toBe('8 kWh');
    expect(screen.getByText(/absolute average power × duration/)).toBeInTheDocument();
    expect(value('Energy recovered')).toBe('—');
  });

  it('retains known zero energy and nullable arrays without confusing them with missing readings', () => {
    const drive = driveFixture({ energyUsedWh: 0, regenEnergyWh: 0 });
    Object.assign(drive, { telemetry: null, positions: null });
    render(<MoreDetailsPanel drive={drive} stats={statsFixture()} />);
    expect(value('Energy consumed')).toBe('0 kWh');
    expect(value('Energy recovered')).toBe('0 kWh');
  });

  it('shows both odometer endpoints including independently missing readings', () => {
    render(<MoreDetailsPanel drive={driveFixture()} stats={statsFixture({ odometerEnd: 0 })} />);
    expect(value('Odometer (from → to)')).toBe('10,000.00 → — km');
  });

  it('labels an ongoing drive odometer as start to latest rather than a completed endpoint', () => {
    render(<MoreDetailsPanel drive={driveFixture({ endTs: null })} stats={statsFixture()} />);
    expect(value('Odometer (start → latest)')).toBe('10,000.00 → 10,040.00 km');
    expect(screen.queryByRole('rowheader', { name: 'Odometer (from → to)' })).toBeNull();
  });

  it('retains range endpoints, delta and method without re-converting display-unit stats', () => {
    prefs.distance = 'mi';
    render(<MoreDetailsPanel drive={driveFixture()} stats={statsFixture({ startRange: 100, endRange: 80 })} />);
    expect(value('Range (start → end)')).toBe('100.00 → 80.00 mi');
    expect(value('Range used')).toBe('20.00 mi');
    expect(screen.getByText(/rated range is the fallback/)).toBeInTheDocument();
  });

  it('surfaces partial range endpoints and unknown battery rather than question marks or zeros', () => {
    render(<MoreDetailsPanel drive={driveFixture({ startBatteryPct: null })} stats={statsFixture({ endRange: null })} />);
    expect(value('Range (start → end)')).toBe('300.00 → — km');
    expect(value('Range used')).toBe('—');
    expect(value('Battery used')).toBe('—');
  });

  it('renders zero SOC and signed SOC delta honestly', () => {
    render(<MoreDetailsPanel drive={driveFixture({ startBatteryPct: 0, endBatteryPct: 10 })} stats={statsFixture()} />);
    expect(value('Battery used')).toBe('-10.00%');
  });

  it('keeps ideal, rated and estimated ranges separate rather than equating their values', () => {
    render(<MoreDetailsPanel drive={driveFixture()} stats={statsFixture()} chartData={[
      pointFixture({ idealRange: 300, ratedRange: 250, estRange: 200 }),
      pointFixture({ idealRange: 280, ratedRange: 230, estRange: 180 }),
    ]} />);
    expect(value('Range (ideal)')).toBe('300.00 → 280.00 km');
    expect(value('Range (rated)')).toBe('250.00 → 230.00 km');
    expect(value('Range (est.)')).toBe('200.00 → 180.00 km');
    expect(value('Range used')).toBe('20.00 km');
    expect(screen.queryByRole('rowheader', { name: 'Range (start → end)' })).toBeNull();
  });

  it('does not subtract a different estimator from a single ideal reading', () => {
    render(<MoreDetailsPanel drive={driveFixture()} stats={statsFixture()} chartData={[
      pointFixture({ idealRange: 300, ratedRange: null }),
      pointFixture({ idealRange: null, ratedRange: 200 }),
    ]} />);
    expect(value('Range (ideal)')).toBe('300.00 → — km');
    expect(value('Range (rated)')).toBe('200.00 → — km');
    expect(value('Range used')).toBe('—');
  });
});
