import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetDriver,
  useUpdateFleetDriver,
  type DriverStatus,
  type FleetDriver,
} from '@/api/hooks/useFleetOps';
import { Button, ConfirmDialog, Input, Modal, Select } from '@/components/ui';
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard';
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
  const [initialValues] = useState(() => ({
    displayName: item?.display_name ?? '',
    referenceCode: item?.reference_code ?? '',
    status: item?.status ?? 'active' as DriverStatus,
  }));
  const [displayName, setDisplayName] = useState(initialValues.displayName);
  const [referenceCode, setReferenceCode] = useState(initialValues.referenceCode);
  const [status, setStatus] = useState<DriverStatus>(initialValues.status);
  const [errors, setErrors] = useState<Partial<Record<'displayName' | 'referenceCode', string>>>({});
  const error = createMutation.error ?? updateMutation.error;
  const pending = createMutation.isPending || updateMutation.isPending;
  const isDirty = displayName !== initialValues.displayName
    || referenceCode !== initialValues.referenceCode
    || status !== initialValues.status;
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
      'fleetOps.driverDialog.unsaved',
      'You have unsaved driver changes. Discard them?',
      ),
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    const reference = referenceCode.trim();
    const nextErrors: typeof errors = {};
    if (!name) {
      nextErrors.displayName = t('fleetOps.driverDialog.nameRequired', 'Enter a display name.');
    } else if (name.length > 120) {
      nextErrors.displayName = t('fleetOps.driverDialog.nameLimit', 'Use 120 characters or fewer.');
    }
    if (!reference) {
      nextErrors.referenceCode = t('fleetOps.driverDialog.referenceRequired', 'Enter a reference code.');
    } else if (reference.length > 64) {
      nextErrors.referenceCode = t('fleetOps.driverDialog.referenceLimit', 'Use 64 characters or fewer.');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
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
        onClose={requestClose}
        title={item
          ? t('fleetOps.driverDialog.editTitle', 'Edit driver')
          : t('fleetOps.driverDialog.createTitle', 'Add driver')}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            label={t('fleetOps.driverDialog.name', 'Display name')}
            value={displayName}
            maxLength={120}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setErrors((current) => ({ ...current, displayName: undefined }));
            }}
            error={errors.displayName}
            required
          />
          <Input
            label={t('fleetOps.driverDialog.reference', 'Non-sensitive reference code')}
            value={referenceCode}
            maxLength={64}
            onChange={(event) => {
              setReferenceCode(event.target.value);
              setErrors((current) => ({ ...current, referenceCode: undefined }));
            }}
            error={errors.referenceCode}
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
          <div className="flex justify-between gap-2">
            <div>
              {item && (
                <Button type="button" variant="danger" onClick={() => onDelete(item)}>
                  {t('common.delete', 'Delete')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={requestClose}>
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
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </>
  );
}
