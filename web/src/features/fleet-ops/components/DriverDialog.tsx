import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetDriver,
  useUpdateFleetDriver,
  type DriverStatus,
  type FleetDriver,
} from '@/api/hooks/useFleetOps';
import { Button, Input, Modal, Select } from '@/components/ui';
import { MutationErrorDialog } from './MutationErrorDialog';

interface DriverDialogProps {
  item: FleetDriver | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (item: FleetDriver) => void;
  onRefresh: () => void;
}

export function DriverDialog({
  item,
  onClose,
  onSaved,
  onDelete,
  onRefresh,
}: DriverDialogProps) {
  const { t } = useTranslation();
  const createMutation = useCreateFleetDriver();
  const updateMutation = useUpdateFleetDriver();
  const [displayName, setDisplayName] = useState(item?.display_name ?? '');
  const [referenceCode, setReferenceCode] = useState(item?.reference_code ?? '');
  const [status, setStatus] = useState<DriverStatus>(item?.status ?? 'active');
  const [validation, setValidation] = useState<string | null>(null);
  const error = createMutation.error ?? updateMutation.error;
  const pending = createMutation.isPending || updateMutation.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    const reference = referenceCode.trim();
    if (name.length < 1 || name.length > 120 || reference.length < 1 || reference.length > 64) {
      setValidation(t('fleetOps.driverDialog.validation', 'Name and reference are required and must fit their limits.'));
      return;
    }
    setValidation(null);
    const input = { display_name: name, reference_code: reference, status };
    if (item) {
      updateMutation.mutate(
        { id: item.id, version: item.version, input },
        { onSuccess: onSaved },
      );
    } else {
      createMutation.mutate(input, { onSuccess: onSaved });
    }
  };
  const resetError = () => {
    createMutation.reset();
    updateMutation.reset();
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={item
          ? t('fleetOps.driverDialog.editTitle', 'Edit driver')
          : t('fleetOps.driverDialog.createTitle', 'Add driver')}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            label={t('fleetOps.driverDialog.name', 'Display name')}
            value={displayName}
            maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
          <Input
            label={t('fleetOps.driverDialog.reference', 'Non-sensitive reference code')}
            value={referenceCode}
            maxLength={64}
            onChange={(event) => setReferenceCode(event.target.value)}
            required
          />
          <Select
            label={t('fleetOps.driverDialog.status', 'Status')}
            value={status}
            onChange={(event) => setStatus(event.target.value as DriverStatus)}
            options={[
              { value: 'active', label: t('fleetOps.drivers.active', 'Active') },
              { value: 'inactive', label: t('fleetOps.drivers.inactive', 'Inactive') },
            ]}
          />
          {validation && <p role="alert" className="text-sm text-rose-300">{validation}</p>}
          <div className="flex justify-between gap-2">
            <div>
              {item && (
                <Button type="button" variant="danger" onClick={() => onDelete(item)}>
                  {t('common.delete', 'Delete')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {t('common.save', 'Save')}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
      <MutationErrorDialog
        error={error}
        resourceName={t('fleetOps.delete.driver', 'driver')}
        onClose={resetError}
        onRefresh={() => {
          resetError();
          onRefresh();
          onClose();
        }}
      />
    </>
  );
}
