import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandDialogs, type ActiveCommandDialog } from './CommandDialogs';
import { COMMANDS, type Vehicle } from '../../commands';

vi.mock('../CommandInputDialog', () => ({
  CommandInputDialog: ({ onSubmit, onClose }: { onSubmit: (values: Record<string, string>) => void; onClose: () => void }) => (
    <div>
      <div role="button" tabIndex={0} onClick={() => onSubmit({ password: '9182' })}>Submit fixture PIN</div>
      <div role="button" tabIndex={0} onClick={onClose}>Cancel fixture</div>
    </div>
  ),
}));

const vehicle: Vehicle = { id: 42, vin: 'QA', state: 'online', display_name: 'QA', model: 'Model 3', updated_at: '2026-10-14T00:00:00Z' };
const active: ActiveCommandDialog = { kind: 'input', definition: COMMANDS.find(def => def.id === 'valet_mode')!, vehicleId: 42 };

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
