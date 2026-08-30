import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (
        typeof fallback === 'string' ? fallback : key
      ),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useFleetOps', () => {
  const mutation = () => ({
    mutate: h.mutate,
    reset: h.reset,
    isPending: false,
    error: null,
  });
  return {
    useCreateFleetDriver: mutation,
    useUpdateFleetDriver: mutation,
    useCreateFleetCostCenter: mutation,
    useUpdateFleetCostCenter: mutation,
    useCreateFleetAssignment: mutation,
    useUpdateFleetAssignment: mutation,
    useCreateFleetReservation: mutation,
    useUpdateFleetReservation: mutation,
    useCreateFleetChargingPolicy: mutation,
    useUpdateFleetChargingPolicy: mutation,
    useCreateFleetWorkOrder: mutation,
    useUpdateFleetWorkOrder: mutation,
  };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatPower: (watts: number) => `${watts} W`,
  }),
}));

import { AssignmentDialog } from './AssignmentDialog';
import { ChargingPolicyDialog } from './ChargingPolicyDialog';
import { CostCenterDialog } from './CostCenterDialog';
import { DriverDialog } from './DriverDialog';
import { ReservationDialog } from './ReservationDialog';
import { WorkOrderDialog } from './WorkOrderDialog';

interface DialogCase {
  name: string;
  renderDialog: (onClose: () => void) => ReactElement;
  dirtyField: RegExp;
  invalidField: RegExp;
  error: string;
}

const commonCallbacks = {
  onSaved: vi.fn(),
  onRefresh: vi.fn(),
};

const cases: DialogCase[] = [
  {
    name: 'driver',
    renderDialog: (onClose) => (
      <DriverDialog
        item={null}
        onClose={onClose}
        onDelete={vi.fn()}
        {...commonCallbacks}
      />
    ),
    dirtyField: /^Display name/,
    invalidField: /^Display name/,
    error: 'Enter a display name.',
  },
  {
    name: 'cost center',
    renderDialog: (onClose) => (
      <CostCenterDialog
        item={null}
        onClose={onClose}
        onDelete={vi.fn()}
        {...commonCallbacks}
      />
    ),
    dirtyField: /^Code/,
    invalidField: /^Code/,
    error: 'Enter a cost-center code.',
  },
  {
    name: 'assignment',
    renderDialog: (onClose) => (
      <AssignmentDialog
        item={null}
        drivers={[]}
        vehicles={[]}
        onClose={onClose}
        onDelete={vi.fn()}
        {...commonCallbacks}
      />
    ),
    dirtyField: /^Notes/,
    invalidField: /^Vehicle/,
    error: 'Choose a vehicle.',
  },
  {
    name: 'reservation',
    renderDialog: (onClose) => (
      <ReservationDialog
        item={null}
        vehicles={[]}
        assignments={[]}
        costCenters={[]}
        onClose={onClose}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
        {...commonCallbacks}
      />
    ),
    dirtyField: /^Reservation name/,
    invalidField: /^Reservation name/,
    error: 'Enter a reservation name.',
  },
  {
    name: 'charging policy',
    renderDialog: (onClose) => (
      <ChargingPolicyDialog
        item={null}
        vehicles={[]}
        onClose={onClose}
        onDelete={vi.fn()}
        {...commonCallbacks}
      />
    ),
    dirtyField: /^Policy name/,
    invalidField: /^Vehicle/,
    error: 'Choose a vehicle.',
  },
  {
    name: 'work order',
    renderDialog: (onClose) => (
      <WorkOrderDialog
        item={null}
        vehicles={[]}
        costCenters={[]}
        onClose={onClose}
        onDelete={vi.fn()}
        {...commonCallbacks}
      />
    ),
    dirtyField: /^Title/,
    invalidField: /^Vehicle/,
    error: 'Choose a vehicle.',
  },
];

beforeEach(() => {
  h.mutate.mockReset();
  h.reset.mockReset();
  commonCallbacks.onSaved.mockReset();
  commonCallbacks.onRefresh.mockReset();
});

describe('fleet resource editor dialogs', () => {
  it.each(cases)('$name protects dirty edits before closing', async ({
    renderDialog,
    dirtyField,
  }) => {
    const onClose = vi.fn();
    render(renderDialog(onClose));
    fireEvent.change(screen.getByLabelText(dirtyField), {
      target: { value: 'Unsaved value' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it.each(cases)('$name associates validation with the failing field', ({
    renderDialog,
    invalidField,
    error,
  }) => {
    render(renderDialog(vi.fn()));
    const dialog = screen.getByRole('dialog');
    const form = dialog.querySelector('form');
    if (!form) throw new Error('fleet editor form not found');

    fireEvent.submit(form);

    const field = screen.getByLabelText(invalidField);
    expect(screen.getByText(error)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('aria-describedby');
    expect(h.mutate).not.toHaveBeenCalled();
  });
});
