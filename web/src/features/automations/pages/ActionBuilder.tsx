import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { Plus } from 'lucide-react';
import type { NotificationChannel } from '@/types/notifications';
import type { AutomationActionStepInput } from '../components/stepInputTypes';
import { ACTION_TYPES } from '../components/automation-helper-source-closure/actionOptions';
import { createDefaultAction } from '../components/automation-helper-source-closure/actionHelpers';
import { ActionStepRow } from '../components/automation-helper-source-closure/ActionStepRow';

export { ACTION_TYPES };

interface ActionBuilderProps {
  actions: AutomationActionStepInput[];
  channels: NotificationChannel[];
  onChange: (actions: AutomationActionStepInput[]) => void;
}

export function ActionBuilder({ actions = [], channels = [], onChange }: ActionBuilderProps) {
  const { t } = useTranslation();

  const defaultChannelId = useMemo(
    () => channels.find((channel) => channel.enabled)?.id ?? channels[0]?.id ?? 0,
    [channels],
  );

  const actionTypeOptions = useMemo(
    () => ACTION_TYPES.map((action) => ({
      value: action.value,
      label: t(action.labelKey, action.fallback),
    })),
    [t],
  );

  const channelOptions = useMemo(
    () => channels.map((channel) => ({
      value: String(channel.id),
      label: `${channel.name} (${channel.kind})`,
      disabled: !channel.enabled,
    })),
    [channels],
  );

  const addAction = useCallback(() => {
    onChange([...actions, createDefaultAction('action_command', defaultChannelId)]);
  }, [actions, defaultChannelId, onChange]);

  const removeAction = useCallback(
    (index: number) => onChange(actions.filter((_, currentIndex) => currentIndex !== index)),
    [actions, onChange],
  );

  const replaceAction = useCallback(
    (index: number, nextAction: AutomationActionStepInput) => {
      onChange(actions.map((action, currentIndex) => (
        currentIndex === index ? nextAction : action
      )));
    },
    [actions, onChange],
  );

  const moveAction = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= actions.length) return;
      const next = [...actions];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [actions, onChange],
  );

  return (
    <div className="min-w-0 space-y-3">
      {actions.map((action, index) => (
        <ActionStepRow
          key={`${action.kind}-${index}`}
          action={action}
          index={index}
          actionCount={actions.length}
          defaultChannelId={defaultChannelId}
          actionTypeOptions={actionTypeOptions}
          channelOptions={channelOptions}
          onChange={(nextAction) => replaceAction(index, nextAction)}
          onMove={(direction) => moveAction(index, direction)}
          onRemove={() => removeAction(index)}
        />
      ))}

      <Button type="button" variant="ghost" size="sm" wrapLabel onClick={addAction} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
        {t('automations.builder.addAction', 'Add action')}
      </Button>
    </div>
  );
}
