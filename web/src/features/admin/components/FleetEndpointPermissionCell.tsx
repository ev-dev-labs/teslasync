import { Text, Toggle, Tooltip } from '@/components/ui';
import { VisuallyHidden } from '@/components/a11y';

export function FleetEndpointPermissionCell({ label, state, name, checked, disabled, help, onChange }: {
  label: string;
  state: string;
  name: string;
  checked: boolean;
  disabled: boolean;
  help?: string;
  onChange?: () => void;
}) {
  const toggle = onChange && <Toggle checked={checked} disabled={disabled}
    focusableWhenDisabled={Boolean(help)} size="sm" aria-label={name} onChange={onChange} />;
  return <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
    {toggle && (help ? <Tooltip multiline content={help}>{toggle}</Tooltip> : toggle)}
    <Text size="xs" color={checked ? 'primary' : 'secondary'} className="min-w-0 break-words">
      <VisuallyHidden>{label}: </VisuallyHidden>{state}
    </Text>
  </div>;
}
