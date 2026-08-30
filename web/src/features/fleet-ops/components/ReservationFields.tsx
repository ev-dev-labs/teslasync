import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type FleetAssignment,
  type FleetCostCenter,
  type FleetReservation,
  type ReservationStatus,
} from '@/api/hooks/useFleetOps';
import { Input, Select, Textarea } from '@/components/ui';
import type { VehicleChoice } from './editorTypes';

export interface ReservationFormState {
  title: string;
  purpose: string;
  vehicleId: string;
  driverId: string;
  costCenterId: string;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
}

export type ReservationFieldErrors = Partial<Record<
  'title' | 'purpose' | 'vehicleId' | 'driverId' | 'startsAt' | 'endsAt',
  string
>>;

interface ReservationFieldsProps {
  item: FleetReservation | null;
  value: ReservationFormState;
  errors: ReservationFieldErrors;
  onChange: (patch: Partial<ReservationFormState>) => void;
  vehicles: VehicleChoice[];
  assignments: FleetAssignment[];
  costCenters: FleetCostCenter[];
}

const transitions: Record<ReservationStatus, ReservationStatus[]> = {
  requested: ['requested', 'confirmed'],
  confirmed: ['confirmed', 'completed'],
  cancelled: ['cancelled'],
  completed: ['completed'],
};

export function ReservationFields({
  item,
  value,
  errors,
  onChange,
  vehicles,
  assignments,
  costCenters,
}: ReservationFieldsProps) {
  const { t } = useTranslation();
  const driverOptions = useMemo(() => {
    const start = new Date(value.startsAt);
    const end = new Date(value.endsAt);
    const periodIsValid = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start;
    const seen = new Map<number, string>();
    assignments
      .filter((assignment) => !value.vehicleId || assignment.vehicle_id === Number(value.vehicleId))
      .filter((assignment) => !periodIsValid || (
        new Date(assignment.starts_at) <= start
        && (!assignment.ends_at || new Date(assignment.ends_at) >= end)
      ))
      .forEach((assignment) => seen.set(assignment.driver_id, assignment.driver_display_name));
    return [...seen.entries()].map(([id, label]) => ({ value: String(id), label }));
  }, [assignments, value.endsAt, value.startsAt, value.vehicleId]);
  const statuses = item ? transitions[item.status] : ['requested', 'confirmed'] as ReservationStatus[];
  const statusLabel = (status: ReservationStatus) => ({
    requested: t('fleetOps.status.requested', 'Requested'),
    confirmed: t('fleetOps.status.confirmed', 'Confirmed'),
    cancelled: t('fleetOps.status.cancelled', 'Cancelled'),
    completed: t('fleetOps.status.completed', 'Completed'),
  }[status]);

  return (
    <>
      <Input
        label={t('fleetOps.reservationDialog.name', 'Reservation name')}
        value={value.title}
        maxLength={160}
        onChange={(event) => onChange({ title: event.target.value })}
        error={errors.title}
        required
      />
      <Textarea
        label={t('fleetOps.reservationDialog.purpose', 'Purpose')}
        value={value.purpose}
        maxLength={500}
        rows={2}
        onChange={(event) => onChange({ purpose: event.target.value })}
        error={errors.purpose}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label={t('fleetOps.reservationDialog.vehicle', 'Vehicle')}
          value={value.vehicleId}
          onChange={(event) => onChange({ vehicleId: event.target.value, driverId: '' })}
          error={errors.vehicleId}
          options={vehicles.map((vehicle) => ({
            value: String(vehicle.id),
            label: vehicle.display_name || vehicle.vin || String(vehicle.id),
          }))}
          placeholder={t('fleetOps.reservationDialog.selectVehicle', 'Select vehicle')}
          required
        />
        <Select
          label={t('fleetOps.reservationDialog.driver', 'Driver')}
          value={value.driverId}
          onChange={(event) => onChange({ driverId: event.target.value })}
          error={errors.driverId}
          options={driverOptions}
          placeholder={t('fleetOps.reservationDialog.unassigned', 'Leave unassigned')}
        />
        <Select
          label={t('fleetOps.reservationDialog.costCenter', 'Cost center')}
          value={value.costCenterId}
          onChange={(event) => onChange({ costCenterId: event.target.value })}
          options={costCenters.filter((center) => center.active || center.id === item?.cost_center_id).map((center) => ({
            value: String(center.id),
            label: `${center.code} · ${center.name}`,
          }))}
          placeholder={t('fleetOps.reservationDialog.noCostCenter', 'No cost center')}
        />
        <Select
          label={t('fleetOps.reservationDialog.status', 'Status')}
          value={value.status}
          onChange={(event) => onChange({ status: event.target.value as ReservationStatus })}
          options={statuses.map((status) => ({ value: status, label: statusLabel(status) }))}
        />
        <Input
          type="datetime-local"
          label={t('fleetOps.reservationDialog.starts', 'Starts')}
          value={value.startsAt}
          onChange={(event) => onChange({ startsAt: event.target.value })}
          error={errors.startsAt}
          required
        />
        <Input
          type="datetime-local"
          label={t('fleetOps.reservationDialog.ends', 'Ends')}
          value={value.endsAt}
          onChange={(event) => onChange({ endsAt: event.target.value })}
          error={errors.endsAt}
          required
        />
      </div>
    </>
  );
}
