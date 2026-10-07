import { MonitorSmartphone } from 'lucide-react';
import { WidgetBigNumber } from '../../widgets/shared';
import { SoftwareUpdateBadge, type UpdateStatus } from './SoftwareUpdateBadge';

interface SoftwareUpdateCompactProps {
  version: string;
  updateStatus: UpdateStatus;
}

export function SoftwareUpdateCompact({ version, updateStatus }: SoftwareUpdateCompactProps) {
  return (
    <div className="h-full min-w-0 flex flex-col items-center justify-center gap-1.5">
      <MonitorSmartphone className="h-5 w-5 text-cyan-300" aria-hidden="true" />
      <WidgetBigNumber value={version || '—'} align="center" size="secondary" />
      <SoftwareUpdateBadge status={updateStatus} />
    </div>
  );
}
