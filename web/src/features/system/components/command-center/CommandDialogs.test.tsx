import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandDialogs, type ActiveCommandDialog } from './CommandDialogs';
import { COMMANDS, type Vehicle } from '../../commands';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';

const capability = vi.hoisted(() => ({
  query: {} as DataStateSource<VehicleLiveSignalsResponse>,
  draft: '32',
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useVehicleLiveSignals: () => capability.query,
}));

vi.mock('../CommandInputDialog', () => ({
  CommandInputDialog: ({ onSubmit, onClose, def, disabled, validationNotice }: {
    onSubmit: (values: Record<string, string>) => void; onClose: () => void;
    def: typeof COMMANDS[number]; disabled?: boolean; validationNotice?: ReactNode;
  }) => (
    <div>
      <div data-testid="dialog-capability" data-disabled={disabled} data-max={def.inputConfig?.max} />
      {validationNotice}
      <div role="button" tabIndex={0} onClick={() => onSubmit(def.command === 'set_charging_amps'
        ? { charging_amps: capability.draft } : { password: '9182' })}>Submit fixture PIN</div>
      <div role="button" tabIndex={0} onClick={onClose}>Cancel fixture</div>
    </div>
  ),
}));

const vehicle: Vehicle = { id: 42, vin: 'QA', state: 'online', display_name: 'QA', model: 'Model 3', updated_at: '2026-10-14T00:00:00Z' };
const active: ActiveCommandDialog = { kind: 'input', definition: COMMANDS.find(def => def.id === 'valet_mode')!, vehicleId: 42 };
beforeEach(() => {
  capability.query = { data: undefined, fetchStatus: 'idle', refetch: vi.fn() };
  capability.draft = '32';
});

describe('CommandDialogs — authoritative amperage', () => {
  const amps: ActiveCommandDialog = {
    kind: 'input', definition: COMMANDS.find(def => def.id === 'set_charging_amps')!, vehicleId: 42,
  };
  function installMaximum(value = 32, ts = new Date().toISOString()) {
    capability.query = {
      data: { vehicle_id: 42, signals: { ChargeCurrentRequestMax: {
        value, kind: 'ValueKindFloat', ts, source: 'l1', age_ms: 0,
      } } }, fetchStatus: 'idle', refetch: vi.fn(),
    };
  }
  function mount() {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    const props = { active: amps, vehicle, loading: false, onExecute, onClose };
    return { ...render(<CommandDialogs {...props} />, { wrapper: MemoryRouter }), props, onExecute, onClose };
  }

  it.each(['missing', 'paused', 'failed', 'stale'])('blocks a %s maximum, including stale child submit handlers', kind => {
    if (kind === 'stale') installMaximum(32, new Date(Date.now() - 121000).toISOString());
    if (kind === 'paused') capability.query.fetchStatus = 'paused';
    if (kind === 'failed') capability.query.error = new Error('capability unavailable');
    const { onExecute, onClose } = mount();
    expect(screen.getByTestId('dialog-capability')).toHaveAttribute('data-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Submit fixture PIN' }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rechecks a changed maximum while retaining the draft and never mutates the catalogue', () => {
    installMaximum();
    const { rerender, props, onExecute } = mount();
    expect(screen.getByTestId('dialog-capability')).toHaveAttribute('data-max', '32');
    installMaximum(16);
    rerender(<CommandDialogs {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit fixture PIN' }));
    expect(onExecute).not.toHaveBeenCalled();
    capability.draft = '16';
    fireEvent.click(screen.getByRole('button', { name: 'Submit fixture PIN' }));
    expect(onExecute).toHaveBeenCalledExactlyOnceWith('set_charging_amps', { charging_amps: '16' });
    expect(amps.definition.inputConfig?.max).toBeUndefined();
  });

  it('rejects capability that ages after render and before submit', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-14T07:45:00Z'));
    try {
      installMaximum(32, '2026-10-14T07:44:00Z');
      const { onExecute } = mount();
      expect(screen.getByTestId('dialog-capability')).toHaveAttribute('data-disabled', 'false');
      vi.mocked(Date.now).mockReturnValue(Date.parse('2026-10-14T07:47:00Z'));
      fireEvent.click(screen.getByRole('button', { name: 'Submit fixture PIN' }));
      expect(onExecute).not.toHaveBeenCalled();
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it('preserves an authoritative zero maximum and the original charging_amps wire parameter', () => {
    installMaximum(0);
    capability.draft = '0';
    const { onExecute, onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Submit fixture PIN' }));
    expect(onExecute).toHaveBeenCalledExactlyOnceWith('set_charging_amps', { charging_amps: '0' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('CommandDialogs — scoped PIN intent', () => {
  it('forwards the configured PIN payload once then disposes the dialog without storing acceptance as measured truth', () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    render(<CommandDialogs active={active} vehicle={vehicle} loading={false} onExecute={onExecute} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit fixture PIN' }));
    expect(onExecute).toHaveBeenCalledExactlyOnceWith('set_valet_mode', { on: 'true', password: '9182' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks a loading submit even if an old child submit handler fires', () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    render(<CommandDialogs active={active} vehicle={vehicle} loading onExecute={onExecute} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit fixture PIN' }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not mount or retarget a PIN dialog belonging to a different selected vehicle', () => {
    const onExecute = vi.fn();
    render(<CommandDialogs active={active} vehicle={{ ...vehicle, id: 43 }} loading={false} onExecute={onExecute} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Submit fixture PIN' })).not.toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('explicit cancellation never submits a PIN', () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    render(<CommandDialogs active={active} vehicle={vehicle} loading={false} onExecute={onExecute} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel fixture' }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
