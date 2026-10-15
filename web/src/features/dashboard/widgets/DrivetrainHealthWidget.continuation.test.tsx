import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { fmtNumber } from '@/lib/numberFormat';
import { convertTempFromSI } from '@/lib/unitConversion';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import DrivetrainHealthWidget from './DrivetrainHealthWidget';

const hooks = vi.hoisted(() => ({ vehicles: vi.fn(), health: vi.fn(), motor: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => hooks.vehicles(),
  useMotorLatest: (...args: unknown[]) => hooks.motor(...args),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrivetrainHealth: (...args: unknown[]) => hooks.health(...args),
}));

function expectTemperature(label: string, celsius: number) {
  const brief = within(screen.getByTestId('dashboard-drivetrain-readings-brief'));
  const metric = brief.getAllByRole('listitem').find(item => within(item).queryByText(label));
  if (!metric) throw new Error(`Missing drivetrain metric: ${label}`);
  expect(within(metric).getByText(`${fmtNumber(convertTempFromSI(celsius, '°C'))}°C`)).toBeVisible();
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.vehicles.mockReturnValue(queryResult([{ id: 7 }]));
  hooks.health.mockReturnValue(queryResult({ overallHealth: 'good', frontMotorTempC: 40, rearMotorTempC: 41, inverterTempC: 42 }));
  hooks.motor.mockReturnValue(queryResult({ motor_temp_c_front: 30, motor_temp_c_rear: 31, di_stator_temp: 32, state_front: 'Standby' }));
});

describe('categorical assessment and motor independence', () => {
  it('keeps real motor temperatures when the inferred assessment fails and retries only the failed source', () => {
    const retryHealth = vi.fn();
    const retryMotor = vi.fn();
    hooks.health.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Assessment offline'), refetch: retryHealth }));
    hooks.motor.mockReturnValue(queryResult({ motor_temp_c_front: 30, motor_temp_c_rear: 31, di_stator_temp: 32 }, { refetch: retryMotor }));
    renderWidget(<DrivetrainHealthWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByText('The drivetrain assessment could not be loaded.')).toBeVisible();
    expectTemperature('Motor temp', 30);
    expectTemperature('Rear motor temp', 31);
    expectTemperature('Stator temp', 32);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryHealth).toHaveBeenCalledOnce();
    expect(retryMotor).not.toHaveBeenCalled();
  });

  it('retains available health temperatures, categorical Healthy and inspection caveat while motor fails', () => {
    const retryHealth = vi.fn();
    const retryMotor = vi.fn();
    hooks.health.mockReturnValue(queryResult({ overallHealth: 'good', frontMotorTempC: 40, rearMotorTempC: 41, inverterTempC: 42 }, { refetch: retryHealth }));
    hooks.motor.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Motor offline'), refetch: retryMotor }));
    renderWidget(<DrivetrainHealthWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByText('Healthy')).toBeVisible();
    expectTemperature('Motor temp', 40);
    expectTemperature('Rear motor temp', 41);
    expectTemperature('Inverter', 42);
    expect(screen.getByText('Assessment from available telemetry; not a mechanical inspection.')).toBeVisible();
    expect(screen.queryByText('95%')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(retryMotor).toHaveBeenCalledOnce();
    expect(retryHealth).not.toHaveBeenCalled();
  });
});
