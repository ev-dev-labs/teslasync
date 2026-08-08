import { Ban, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FleetReservation } from '@/api/hooks/useFleetOps';
import { Button } from '@/components/ui';

interface ReservationActionsProps {
  item: FleetReservation;
  onEdit: (item: FleetReservation) => void;
  onCancel: (item: FleetReservation) => void;
  onDelete: (item: FleetReservation) => void;
}

export function ReservationActions({
  item,
  onEdit,
  onCancel,
  onDelete,
}: ReservationActionsProps) {
  const { t } = useTranslation();
  const active = item.status === 'requested' || item.status === 'confirmed';
  return (
    <div className="flex justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 px-0"
        aria-label={t('fleetOps.reservations.edit', 'Edit {{name}}', { name: item.title })}
        onClick={() => onEdit(item)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      {active && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11 px-0 text-amber-300"
          aria-label={t('fleetOps.reservations.cancelNamed', 'Cancel {{name}}', { name: item.title })}
          onClick={() => onCancel(item)}
        >
          <Ban className="h-4 w-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 px-0 text-rose-300"
        aria-label={t('fleetOps.reservations.delete', 'Delete {{name}}', { name: item.title })}
        onClick={() => onDelete(item)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
