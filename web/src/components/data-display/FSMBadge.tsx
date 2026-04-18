import { Badge } from '@/components/ui';

const FSM_COLORS: Record<
  string,
  { variant: 'success' | 'warning' | 'info' | 'danger' | 'neutral'; label: string }
> = {
  vehicle: { variant: 'info', label: 'Vehicle' },
  drive_session: { variant: 'success', label: 'Drive' },
  charge_session: { variant: 'warning', label: 'Charge' },
  command: { variant: 'danger', label: 'Command' },
  notification: { variant: 'neutral', label: 'Notify' },
  alert_cooldown: { variant: 'neutral', label: 'Cooldown' },
  automation: { variant: 'info', label: 'Automation' },
};

export function FSMBadge({ type }: { type: string }) {
  const config = FSM_COLORS[type] ?? { variant: 'neutral' as const, label: type };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
