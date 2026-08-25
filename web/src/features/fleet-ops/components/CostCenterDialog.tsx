import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetCostCenter,
  useUpdateFleetCostCenter,
  type FleetCostCenter,
} from '@/api/hooks/useFleetOps';
import { Button, ConfirmDialog, Input, Modal, Toggle } from '@/components/ui';
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard';
import { MutationErrorDialog } from './MutationErrorDialog';

interface CostCenterDialogProps {
  item: FleetCostCenter | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (item: FleetCostCenter) => void;
  onRefresh: () => void;
}

export function CostCenterDialog({
  item,
  onClose,
  onSaved,
  onDelete,
  onRefresh,
}: CostCenterDialogProps) {
  const { t } = useTranslation();
  const createMutation = useCreateFleetCostCenter();
  const updateMutation = useUpdateFleetCostCenter();
  const [initialValues] = useState(() => ({
    code: item?.code ?? '',
    name: item?.name ?? '',
    active: item?.active ?? true,
  }));
  const [code, setCode] = useState(initialValues.code);
  const [name, setName] = useState(initialValues.name);
  const [active, setActive] = useState(initialValues.active);
  const [errors, setErrors] = useState<Partial<Record<'code' | 'name', string>>>({});
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;
  const isDirty = code !== initialValues.code
    || name !== initialValues.name
    || active !== initialValues.active;
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
      'fleetOps.costCenterDialog.unsaved',
      'You have unsaved cost-center changes. Discard them?',
      ),
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    const normalizedName = name.trim();
    const nextErrors: typeof errors = {};
    if (!normalizedCode) {
      nextErrors.code = t('fleetOps.costCenterDialog.codeRequired', 'Enter a cost-center code.');
    } else if (normalizedCode.length > 32) {
      nextErrors.code = t('fleetOps.costCenterDialog.codeLimit', 'Use 32 characters or fewer.');
    }
    if (!normalizedName) {
      nextErrors.name = t('fleetOps.costCenterDialog.nameRequired', 'Enter a cost-center name.');
    } else if (normalizedName.length > 120) {
      nextErrors.name = t('fleetOps.costCenterDialog.nameLimit', 'Use 120 characters or fewer.');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const input = { code: normalizedCode, name: normalizedName, active };
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
          ? t('fleetOps.costCenterDialog.editTitle', 'Edit cost center')
          : t('fleetOps.costCenterDialog.createTitle', 'Add cost center')}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('fleetOps.costCenterDialog.code', 'Code')}
              value={code}
              maxLength={32}
              onChange={(event) => {
                setCode(event.target.value);
                setErrors((current) => ({ ...current, code: undefined }));
              }}
              error={errors.code}
              required
            />
            <Input
              label={t('fleetOps.costCenterDialog.name', 'Name')}
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((current) => ({ ...current, name: undefined }));
              }}
              error={errors.name}
              required
            />
          </div>
          <Toggle
            checked={active}
            onChange={setActive}
            label={t('fleetOps.costCenterDialog.active', 'Available for new fleet activity')}
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
              <Button type="button" variant="ghost" onClick={requestClose}>{t('common.cancel', 'Cancel')}</Button>
              <Button type="submit" loading={pending}>{t('common.save', 'Save')}</Button>
            </div>
          </div>
        </form>
      </Modal>
      <MutationErrorDialog
        error={error}
        resourceName={t('fleetOps.delete.costCenter', 'cost center')}
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
