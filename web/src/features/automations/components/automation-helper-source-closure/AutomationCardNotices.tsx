import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { severityTokens } from '@/lib/tokens';
import type { Automation } from '@/api/types';

export function AutomationCardNotices({ automation: a }: { automation: Automation }) {
  const { t } = useTranslation();
  const conflicts = a.conflicts ?? [];
  return (
    <>
      {a.auto_disabled && a.auto_disabled_reason && (
        <div className={cn('mt-2 flex min-w-0 items-start gap-2 rounded-md px-3 py-2', severityTokens.critical.bg)}>
          <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', severityTokens.critical.fg)} aria-hidden="true" />
          <Text as="span" variant="bodySm" className="min-w-0 break-words">{a.auto_disabled_reason}</Text>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="mt-2 min-w-0 space-y-1">
          {conflicts.map((c, i) => {
            const isWarning = c.severity === 'warning';
            const tone = severityTokens[isWarning ? 'warn' : 'info'];
            return (
              <div
                key={`conflict-${a.id}-${i}`}
                className={cn('flex min-w-0 items-start gap-2 rounded-md px-3 py-1.5', tone.bg)}
              >
                <AlertTriangle className={cn('mt-0.5 h-3 w-3 shrink-0', tone.fg)} aria-hidden="true" />
                <Text as="span" variant="bodySm" className="min-w-0 break-words">
                  {t('automations.conflictWith', 'Conflict with')}{' '}
                  <Text as="span" weight="medium">"{c.automation_name}"</Text>
                  {' — '}{c.reason}
                </Text>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
