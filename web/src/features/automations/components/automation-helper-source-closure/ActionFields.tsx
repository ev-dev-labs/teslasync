import type { AutomationActionStepInput } from '../stepInputTypes';
import { ActionCommandFields } from './ActionCommandFields';
import { ActionNotificationFields } from './ActionNotificationFields';
import { ActionSettingFields } from './ActionSettingFields';
import { ActionCallFields } from './ActionCallFields';

interface ActionFieldsProps {
  action: AutomationActionStepInput;
  channelOptions: { value: string; label: string; disabled?: boolean }[];
  onChange: (action: AutomationActionStepInput) => void;
}

export function ActionFields({ action, channelOptions, onChange }: ActionFieldsProps) {
  switch (action.kind) {
    case 'action_command':
      return <ActionCommandFields action={action} onChange={onChange} />;
    case 'action_notify':
      return <ActionNotificationFields action={action} channelOptions={channelOptions} onChange={onChange} />;
    case 'action_set_setting':
      return <ActionSettingFields action={action} onChange={onChange} />;
    case 'action_call_automation':
      return <ActionCallFields action={action} onChange={onChange} />;
  }
}
