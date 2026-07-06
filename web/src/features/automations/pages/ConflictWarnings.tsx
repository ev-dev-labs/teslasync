import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info } from 'lucide-react';
import { AlertBanner } from '@/components/feedback';
import type { AutomationConflict } from '@/api/types';

interface ConflictWarningsProps {
  conflicts?: AutomationConflict[];
}

export function ConflictWarnings({ conflicts }: ConflictWarningsProps) {
  const { t } = useTranslation();
  const items = conflicts ?? [];
  if (items.length === 0) return null;

  const title = t('automations.builder.conflict', 'Potential Conflict');

  return (
    <div className="space-y-2">
      {items.map((c, i) => {
        const isWarning = c.severity === 'warning';
        const name = c.automation_name ?? '—';
        const reason = c.reason ?? '';
        return (
          <AlertBanner
            key={`${c.automation_id ?? 'conflict'}-${i}`}
            role="alert"
            variant={isWarning ? 'warning' : 'info'}
            icon={
              isWarning ? (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Info className="h-4 w-4" aria-hidden="true" />
              )
            }
            title={title}
          >
            {reason ? `"${name}": ${reason}` : `"${name}"`}
          </AlertBanner>
        );
      })}
    </div>
  );
}
