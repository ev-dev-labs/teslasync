import { Badge } from '@/components/ui';

const FSM_COLORS: Record<
  string,
  { variant: 'success' | 'warning' | 'info' | 'danger' | 'neutral'; label: string }
> = {
  vehicle_lifecycle: { variant: 'info', label: 'Vehicle' },
  charging_session: { variant: 'warning', label: 'Charge' },
  trip: { variant: 'success', label: 'Trip' },
  export_job: { variant: 'neutral', label: 'Export' },
};

export function FSMBadge({ type }: { type: string }) {
  const config = FSM_COLORS[type] ?? { variant: 'neutral' as const, label: type };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
