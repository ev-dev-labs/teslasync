import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateFleetCostCenter,
  useUpdateFleetCostCenter,
  type FleetCostCenter,
} from '@/api/hooks/useFleetOps';
import { Button, Input, Modal, Toggle } from '@/components/ui';
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
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [active, setActive] = useState(item?.active ?? true);
  const [validation, setValidation] = useState<string | null>(null);
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    const normalizedName = name.trim();
    if (
      normalizedCode.length < 1
      || normalizedCode.length > 32
      || normalizedName.length < 1
      || normalizedName.length > 120
    ) {
      setValidation(t('fleetOps.costCenterDialog.validation', 'Code and name are required and must fit their limits.'));
      return;
    }
    setValidation(null);
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
        onClose={onClose}
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
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <Input
              label={t('fleetOps.costCenterDialog.name', 'Name')}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <Toggle
            checked={active}
            onChange={setActive}
            label={t('fleetOps.costCenterDialog.active', 'Available for new fleet activity')}
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
              <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
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
    </>
  );
}
