import type {
  FleetAssignment,
  FleetCostCenter,
  FleetDriver,
  FleetReservation,
} from '@/api/hooks/useFleetOps';
import { AssignmentDialog } from './AssignmentDialog';
import { ChargingPolicyDialog } from './ChargingPolicyDialog';
import { CostCenterDialog } from './CostCenterDialog';
import { DriverDialog } from './DriverDialog';
import { ReservationDialog } from './ReservationDialog';
import { WorkOrderDialog } from './WorkOrderDialog';
import type {
  FleetDeleteTarget,
  FleetEditor,
  VehicleChoice,
} from './editorTypes';

interface FleetResourceEditorDialogProps {
  editor: FleetEditor;
  vehicles: VehicleChoice[];
  drivers: FleetDriver[];
  assignments: FleetAssignment[];
  costCenters: FleetCostCenter[];
  onClose: () => void;
  onCancelReservation: (item: FleetReservation) => void;
  onDelete: (target: FleetDeleteTarget) => void;
  onRefresh: () => void;
}

export function FleetResourceEditorDialog({
  editor,
  vehicles,
  drivers,
  assignments,
  costCenters,
  onClose,
  onCancelReservation,
  onDelete,
  onRefresh,
}: FleetResourceEditorDialogProps) {
  switch (editor.kind) {
    case 'driver':
      return (
        <DriverDialog
          item={editor.item}
          onClose={onClose}
          onSaved={onClose}
          onDelete={(item) => onDelete({ kind: 'driver', item })}
          onRefresh={onRefresh}
        />
      );
    case 'assignment':
      return (
        <AssignmentDialog
          item={editor.item}
          drivers={drivers}
          vehicles={vehicles}
          onClose={onClose}
          onSaved={onClose}
          onDelete={(item) => onDelete({ kind: 'assignment', item })}
          onRefresh={onRefresh}
        />
      );
    case 'cost_center':
      return (
        <CostCenterDialog
          item={editor.item}
          onClose={onClose}
          onSaved={onClose}
          onDelete={(item) => onDelete({ kind: 'cost_center', item })}
          onRefresh={onRefresh}
        />
      );
    case 'reservation':
      return (
        <ReservationDialog
          item={editor.item}
          vehicles={vehicles}
          assignments={assignments}
          costCenters={costCenters}
          onClose={onClose}
          onSaved={onClose}
          onCancel={onCancelReservation}
          onDelete={(item) => onDelete({ kind: 'reservation', item })}
          onRefresh={onRefresh}
        />
      );
    case 'charging_policy':
      return (
        <ChargingPolicyDialog
          item={editor.item}
          vehicles={vehicles}
          onClose={onClose}
          onSaved={onClose}
          onDelete={(item) => onDelete({ kind: 'charging_policy', item })}
          onRefresh={onRefresh}
        />
      );
    case 'work_order':
      return (
        <WorkOrderDialog
          item={editor.item}
          vehicles={vehicles}
          costCenters={costCenters}
          onClose={onClose}
          onSaved={onClose}
          onDelete={(item) => onDelete({ kind: 'work_order', item })}
          onRefresh={onRefresh}
        />
      );
  }
}
