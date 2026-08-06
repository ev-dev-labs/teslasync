import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, CircleCheck, CircleX, CalendarX } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import { Timeline } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

import { STATUS_COLOR } from './constants';

interface GDPRLifecyclePanelProps {
  artifact?: GDPRExportArtifact;
  loading?: boolean;
  className?: string;
}

interface LifecycleEntry {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  color?: string;
}

/** Lifecycle timeline — created → completed/failed → expiry, from artifact timestamps. */
export function GDPRLifecyclePanel({ artifact, loading, className }: GDPRLifecyclePanelProps) {
  const { t } = useTranslation();
  const showLoading = Boolean(loading) && !artifact;

  const items = useMemo<LifecycleEntry[]>(() => {
    if (!artifact) return [];
    const list: LifecycleEntry[] = [
      {
        icon: <Clock className="h-3 w-3" aria-hidden="true" />,
        title: t('admin.gdprExport.lifecycle.created', 'Created'),
        subtitle: formatDateTime(artifact.created_at),
        time: formatRelative(artifact.created_at),
        color: STATUS_COLOR.queued,
      },
    ];

    // A `failed` export never truly "completed": suppress the green
    // Completed step so the timeline can't contradict itself. Its terminal
    // timestamp (if any) is surfaced on the Failed entry instead.
    if (artifact.completed_at && artifact.status !== 'failed') {
      list.push({
        icon: <CircleCheck className="h-3 w-3" aria-hidden="true" />,
        title: t('admin.gdprExport.lifecycle.completed', 'Completed'),
        subtitle: formatDateTime(artifact.completed_at),
        time: formatRelative(artifact.completed_at),
        color: STATUS_COLOR.complete,
      });
    }

    if (artifact.status === 'failed') {
      // `?? fallback` only guards null/undefined — an empty or whitespace-only
      // error string would slip through and render a blank subtitle, so fall
      // back to the generic copy for any non-meaningful error.
      const reason =
        artifact.error && artifact.error.trim().length > 0
          ? artifact.error
          : t('admin.gdprExport.lifecycle.failedGeneric', 'Export did not finish');
      list.push({
        icon: <CircleX className="h-3 w-3" aria-hidden="true" />,
        title: t('admin.gdprExport.lifecycle.failed', 'Failed'),
        subtitle: reason,
        time: artifact.completed_at ? formatRelative(artifact.completed_at) : '',
        color: STATUS_COLOR.failed,
      });
    }

    if (artifact.expires_at) {
      const expired =
        artifact.status === 'expired' || new Date(artifact.expires_at).getTime() < Date.now();
      list.push({
        icon: <CalendarX className="h-3 w-3" aria-hidden="true" />,
        title: expired
          ? t('admin.gdprExport.lifecycle.expired', 'Expired')
          : t('admin.gdprExport.lifecycle.expires', 'Expires'),
        subtitle: formatDateTime(artifact.expires_at),
        time: formatRelative(artifact.expires_at),
        color: expired ? STATUS_COLOR.failed : STATUS_COLOR.expired,
      });
    }

    return list;
  }, [artifact, t]);

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.gdprExport.lifecycleTitle', 'Lifecycle')}
      </PanelTitle>
      {showLoading ? (
        <Skeleton height={140} />
      ) : items.length > 0 ? (
        <Timeline items={items} />
      ) : (
        // no-action: like GDPRArtifactDetails, this is derived purely from
        // the parent's `artifact` prop — use the lookup input above.
        <EmptyState
          icon={<Clock className="h-8 w-8" />}
          message={t('admin.gdprExport.lifecycleEmpty', 'No lifecycle events recorded yet.')}
        />
      )}
    </GlassPanel>
  );
}
