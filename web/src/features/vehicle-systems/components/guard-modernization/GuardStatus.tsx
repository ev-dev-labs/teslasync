import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Clock, Lock, Unlock, Info, Eye, AlertTriangle, type LucideIcon } from 'lucide-react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { GlassPanel, PanelTitle, Text, HelperText } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { GuardPageModel } from './useGuardPageModel';

export function GuardStatus({ model: m }: { model: GuardPageModel }) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const LockIcon = m.isLocked == null ? Info : m.isLocked ? Lock : Unlock;
  return (
    <GlassPanel data-guard-section="status"
      className={cn('min-w-0 space-y-3 p-4 sm:p-5', placement?.className)}>
      <PanelTitle className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        {t('guard.status', 'Status')}
      </PanelTitle>
      <HelperText>{t('guard.modernization.policyOnly', 'Saved policy only; not confirmation of active monitoring or successful arming.')}</HelperText>
      <StaleRefreshWarning state={m.vehicleState} label={t('guard.status', 'Status')} />
      {m.vehicleState.fatalError && <QueryError error={m.vehicleState.fatalError} onRetry={m.vehicleState.retry ?? undefined} />}
      <ul className="space-y-3">
        <StatusRow icon={Clock}>
          {m.guardConfig?.updated_at
            ? t('guard.modernization.policyUpdated', 'Policy updated {{time}}', { time: formatDateTime(m.guardConfig.updated_at) })
            : m.guardConfig === null ? t('guard.modernization.notSaved', 'No saved guard policy yet')
              : t('guard.modernization.policyUnknown', 'Saved policy unavailable')}
        </StatusRow>
        <StatusRow icon={LockIcon} tone={m.isLocked == null ? 'muted' : m.isLocked ? 'ok' : 'warn'}>
          {m.isLocked == null ? t('guard.lockUnknown', 'Lock state unavailable')
            : m.isLocked ? t('guard.vehicleLocked', 'Vehicle locked') : t('guard.vehicleUnlocked', 'Vehicle unlocked')}
        </StatusRow>
        <StatusRow icon={Eye} tone={m.sentryOn ? 'ok' : 'muted'}>
          {m.sentryOn == null ? t('guard.sentryUnknown', 'Sentry status unavailable')
            : m.sentryOn ? t('guard.sentryActive', 'Sentry mode active') : t('guard.sentryInactive', 'Sentry mode off')}
        </StatusRow>
        <StatusRow icon={AlertTriangle} tone={m.eventsKnown && m.unacknowledgedCount > 0 ? 'warn' : 'muted'}>
          {!m.eventsKnown ? t('guard.modernization.sourceUnknown', 'Source unavailable; no security conclusion can be drawn.')
            : m.unacknowledgedCount > 0
              ? t('guard.unackEvents', '{{count}} unacknowledged event(s)', { count: m.unacknowledgedCount })
              : t('guard.noActiveAlerts', 'No active alerts')}
        </StatusRow>
      </ul>
      {m.eventsKnown && m.unacknowledgedCount === 0 && (
        <HelperText>{t('guard.modernization.eventsCoverage', 'Counts cover the returned security event history, not a theft detection assessment.')}</HelperText>
      )}
      {m.stateResponse?.observedAt != null && (
        <Text as="p" variant="caption">
          {t('guard.modernization.lastObserved', 'Vehicle source last observed')}{' '}
          <TimeStamp value={new Date(m.stateResponse.observedAt).toISOString()} />
        </Text>
      )}
    </GlassPanel>
  );
}

const STATUS_TONE = {
  ok: 'text-[var(--text-secondary)]',
  warn: 'text-[var(--text-secondary)]',
  muted: 'text-[var(--text-muted)]',
} as const;

function StatusRow({ icon: Icon, tone = 'muted', children }: {
  icon: LucideIcon;
  tone?: keyof typeof STATUS_TONE;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', STATUS_TONE[tone])} aria-hidden="true" />
      <Text as="span" variant="bodySm">{children}</Text>
    </li>
  );
}
