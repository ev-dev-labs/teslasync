import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetAssignment, FleetChargingPolicy, FleetDriver, FleetReservation } from '@/api/hooks/useFleetOps';
import { downloadJSON } from '@/lib/csvExport';
import { AssignmentRoster } from './AssignmentRoster';
import { ChargingPolicyMatrix } from './ChargingPolicyMatrix';
import { DriverRoster } from './DriverRoster';
import { ReservationPanel } from './ReservationPanel';

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(), downloadJSON: vi.fn(),
}));

const versioned = { version: 1, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z' };
const driver: FleetDriver = {
  ...versioned, id: 1, display_name: 'Fleet driver', reference_code: 'DRV-1', status: 'active',
  max_charge_soc: 0, curfew_start: '22:00', curfew_end: '06:00',
};
const assignment: FleetAssignment = {
  ...versioned, id: 2, driver_id: 1, driver_display_name: driver.display_name,
  vehicle_id: 10, vehicle_display_name: 'Pool vehicle', starts_at: versioned.created_at,
  ends_at: null, notes: null,
};
const reservation: FleetReservation = {
  ...versioned, ...assignment, id: 3, title: 'Depot run', purpose: null,
  cost_center_id: null, cost_center_name: null, ends_at: '2026-10-01T14:00:00Z', status: 'confirmed',
};
const policy: FleetChargingPolicy = {
  ...versioned, id: 4, vehicle_id: 10, vehicle_display_name: 'Pool vehicle',
  name: 'Depot nights', priority: 0, target_soc_pct: 80, max_power_w: 11000,
  enabled: true, effective_from: versioned.created_at, effective_to: null,
  windows: [{ day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
};
const callbacks = {
  onRetry: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onCancel: vi.fn(),
};
const common = { ...callbacks, loading: false, error: null, enableValueFilters: true };
const cases = [
  { name: 'drivers', id: 'fleet-ops:drivers', table: 'Fleet drivers', item: driver,
    element: <DriverRoster {...common} items={[driver]} />,
    fields: ['Driver', 'Reference', 'Status', 'Guardrails', 'Actions'],
    value: '0% · 22:00–06:00', edit: 'Edit Fleet driver', remove: 'Delete Fleet driver' },
  { name: 'assignments', id: 'fleet-ops:assignments', table: 'Assignment roster', item: assignment,
    element: <AssignmentRoster {...common} items={[assignment]} />,
    fields: ['Driver', 'Vehicle', 'Starts', 'Ends', 'Actions'],
    value: 'Ongoing', edit: 'Edit assignment for Fleet driver', remove: 'Delete assignment for Fleet driver' },
  { name: 'reservations', id: 'fleet-ops:reservations', table: 'Reservation calendar', item: reservation,
    element: <ReservationPanel {...common} items={[reservation]} />,
    fields: ['Reservation', 'Vehicle', 'Driver', 'Period', 'Status', 'Actions'],
    value: 'Confirmed', edit: 'Edit Depot run', remove: 'Delete Depot run' },
  { name: 'policies', id: 'fleet-ops:charging-policies', table: 'Charging policy matrix', item: policy,
    element: <ChargingPolicyMatrix {...common} items={[policy]} />,
    fields: ['Vehicle', 'Policy', 'Target SoC', 'Max power', 'Allowed windows', 'State', 'Actions'],
    value: 'Mon 00:00–06:00', edit: 'Edit Depot nights', remove: 'Delete Depot nights' },
];
const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-mode');
});

describe.each(['light', 'dark'])('fleet operations mobile integration (%s)', (theme) => {
  it.each(cases)('keeps all $name fields, keyboard actions and export across mobile/desktop', async (entry) => {
    document.documentElement.setAttribute('data-mode', theme);
    const user = userEvent.setup();
    const view = render(entry.element);
    expect(screen.getByRole('table', { name: entry.table })).toBeInTheDocument();
    resize(375);
    const mobile = view.container.querySelector<HTMLElement>('[data-mobile-table]');
    expect(mobile).not.toBeNull();
    const scope = within(mobile!);
    const edit = scope.getByRole('button', { name: entry.edit });
    edit.focus();
    await user.keyboard('{Enter}');
    expect(callbacks.onEdit).toHaveBeenCalledWith(entry.item);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const remove = scope.getByRole('button', { name: entry.remove });
    remove.focus();
    await user.keyboard(' ');
    expect(callbacks.onDelete).toHaveBeenCalledWith(entry.item);
    if (entry.name === 'reservations') {
      const cancel = scope.getByRole('button', { name: 'Cancel Depot run' });
      cancel.focus();
      await user.keyboard('{Enter}');
      expect(callbacks.onCancel).toHaveBeenCalledWith(entry.item);
    }
    const quickView = scope.getByRole('button', { name: 'Quick view' });
    quickView.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    for (const field of entry.fields) expect(within(dialog).getByText(field, { selector: 'dt' })).toBeInTheDocument();
    expect(within(dialog).getByText(entry.value)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(quickView).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Export list' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadJSON).mock.calls[0]?.[1]).toHaveLength(1);
    resize(1440);
    const table = screen.getByRole('table', { name: entry.table });
    for (const field of entry.fields) expect(within(table).getByRole('columnheader', { name: new RegExp(field) })).toBeInTheDocument();
    expect(view.container.querySelector('[data-mobile-table]')).not.toBeInTheDocument();
  });

  it.each(cases)('keeps $name mutation guardrails in mobile actions and full details', async (entry) => {
    const user = userEvent.setup();
    const view = render(cloneElement(entry.element, { actionsDisabled: true, actionsDisabledReason: 'Read only' }));
    resize(375);
    const mobile = within(view.container.querySelector<HTMLElement>('[data-mobile-table]')!);
    expect(mobile.getByRole('button', { name: entry.edit })).toBeDisabled();
    expect(mobile.getByRole('button', { name: entry.remove })).toBeDisabled();
    await user.click(mobile.getByRole('button', { name: 'Quick view' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: entry.edit })).toBeDisabled();
    expect(callbacks.onEdit).not.toHaveBeenCalled();
  });
});
