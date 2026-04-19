import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info } from 'lucide-react';
import { AlertBanner } from '@/components/feedback';
import type { AutomationConflict } from '@/api/types';

interface ConflictWarningsProps {
  conflicts: AutomationConflict[];
}

export function ConflictWarnings({ conflicts }: ConflictWarningsProps) {
  const { t } = useTranslation();
  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-2">
      {conflicts.map((c, i) => (
        <AlertBanner
          key={`${c.automation_id}-${i}`}
          variant={c.severity === 'warning' ? 'warning' : 'info'}
          icon={c.severity === 'warning' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          title={t('automations.builder.conflict', 'Potential Conflict')}
        >
          {`"${c.automation_name}": ${c.reason}`}
        </AlertBanner>
      ))}
    </div>
  );
}
