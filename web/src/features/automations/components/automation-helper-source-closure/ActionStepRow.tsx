import { useTranslation } from 'react-i18next';
import { Button, Select } from '@/components/ui';
import { FormSection } from '@/components/forms';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { AutomationActionKind } from '@/types/automations';
import type { AutomationActionStepInput } from '../stepInputTypes';
import { createDefaultAction } from './actionHelpers';
import { ActionFields } from './ActionFields';

interface ActionStepRowProps {
  action: AutomationActionStepInput;
  index: number;
  actionCount: number;
  defaultChannelId: number;
  actionTypeOptions: { value: string; label: string }[];
  channelOptions: { value: string; label: string; disabled?: boolean }[];
  onChange: (action: AutomationActionStepInput) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

export function ActionStepRow({
  action, index, actionCount, defaultChannelId,
  actionTypeOptions, channelOptions, onChange, onMove, onRemove,
}: ActionStepRowProps) {
  const { t } = useTranslation();
  return (
    <FormSection
      title={t('automations.builder.actionNumber', 'Action {{number}}', { number: index + 1 })}
      className="p-4 sm:p-5"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={t('automations.builder.moveUp', 'Move up')}
          className="min-h-11 min-w-11 p-1"
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onMove(1)}
          disabled={index === actionCount - 1}
          aria-label={t('automations.builder.moveDown', 'Move down')}
          className="min-h-11 min-w-11 p-1"
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={t('automations.builder.removeAction', 'Remove action')}
          className="min-h-11 min-w-11 p-1 text-rose-300 hover:text-rose-200"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Select
            id={`automation-action-kind-${index}`}
            label={t('automations.builder.actionType', 'Action type')}
            options={actionTypeOptions}
            value={action.kind}
            onChange={(event) => onChange(
              createDefaultAction(event.target.value as AutomationActionKind, defaultChannelId),
            )}
            className="w-full"
          />
        </div>
        <ActionFields action={action} channelOptions={channelOptions} onChange={onChange} />
      </div>
    </FormSection>
  );
}
