import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Textarea } from '@/components/ui';
import type { AutomationActionStepInput } from '../stepInputTypes';

interface ActionNotificationFieldsProps {
  action: Extract<AutomationActionStepInput, { kind: 'action_notify' }>;
  channelOptions: { value: string; label: string; disabled?: boolean }[];
  onChange: (action: AutomationActionStepInput) => void;
}

export function ActionNotificationFields({ action, channelOptions, onChange }: ActionNotificationFieldsProps) {
  const { t } = useTranslation();
  const channelId = useId();
  return (
    <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] [&>div]:min-w-0">
      <Select
        id={channelId}
        label={t('automations.builder.channel', 'Channel')}
        options={channelOptions.length > 0
          ? channelOptions
          : [{ value: '0', label: t('automations.builder.noChannels', 'No channels configured') }]}
        value={String(action.channel_id)}
        onChange={(event) => onChange({
          ...action,
          channel_id: Number.parseInt(event.target.value, 10) || 0,
        })}
        className="w-full"
      />
      <div className="min-w-0 w-full">
        <Textarea
          label={t('automations.builder.notifyMessage', 'Message')}
          value={action.template}
          onChange={(event) => onChange({ ...action, template: event.target.value })}
          placeholder={t('automations.builder.notifyPlaceholder', 'Car is warming up!')}
          rows={2}
        />
      </div>
    </div>
  );
}
