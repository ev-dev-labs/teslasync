import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui';
import type { AutomationActionStepInput } from '../stepInputTypes';

interface ActionCallFieldsProps {
  action: Extract<AutomationActionStepInput, { kind: 'action_call_automation' }>;
  onChange: (action: AutomationActionStepInput) => void;
}

export function ActionCallFields({ action, onChange }: ActionCallFieldsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
      <Input
        label={t('automations.builder.targetAutomationId', 'Target automation ID')}
        type="number"
        min={1}
        value={action.target_automation_id || ''}
        onChange={(event) => onChange({
          ...action,
          target_automation_id: Number.parseInt(event.target.value, 10) || 0,
        })}
        className="w-full sm:w-48"
      />
    </div>
  );
}
