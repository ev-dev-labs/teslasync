import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui';
import type { AutomationActionStepInput, AutomationActionWaitStepInput } from '../stepInputTypes';

interface ActionWaitFieldsProps {
  action: AutomationActionWaitStepInput;
  onChange: (action: AutomationActionStepInput) => void;
}

export function ActionWaitFields({ action, onChange }: ActionWaitFieldsProps) {
  const { t } = useTranslation();
  return (
    <Input
      label={t('automations.builder.waitDuration', 'Wait duration (seconds)')}
      type="number"
      min={1}
      max={3600}
      step={1}
      value={Number.isFinite(action.duration_s) ? action.duration_s : ''}
      onChange={(event) => onChange({
        ...action,
        duration_s: event.target.value === '' ? 0 : Number(event.target.value),
      })}
      className="w-full sm:w-48"
    />
  );
}
