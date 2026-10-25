import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';

import { GlassPanel, Icon, PanelTitle } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

import { STATUS_COLOR, STATUS_ICON } from './constants';

interface GDPRLifecyclePanelProps {
  artifact?: GDPRExportArtifact;
  loading?: boolean;
  className?: string;
  now?: number;
}

interface LifecycleEntry {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  color?: string;
  instant: number;
  absolute: string | null;
}

/** Manifest timestamps only; download recording is best effort, not an audit ledger. */
export function GDPRLifecyclePanel({
  artifact,
  loading,
  className,
  now: controlledNow,
}: GDPRLifecyclePanelProps) {
  const { t } = useTranslation();
  const { formatDateTime, formatRelative } = useDateFormat();
  const [clockNow, setClockNow] = useState(Date.now);
  const now = controlledNow ?? clockNow;
  const showLoading = Boolean(loading) && !artifact;
  const label = t('admin.gdprExport.lifecycleTitle', 'Lifecycle');

  useEffect(() => {
    if (controlledNow !== undefined) return;
    setClockNow(Date.now());
    if (!artifact) return;
    const update = () => setClockNow(Date.now());
    const interval = window.setInterval(update, 1_000);
    const remaining = Date.parse(artifact.expires_at) - Date.now();
    const expiryTimer = remaining > 0 && remaining <= 2_147_483_647
      ? window.setTimeout(update, remaining)
      : undefined;
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(expiryTimer);
    };
  }, [artifact, controlledNow]);

  const items: LifecycleEntry[] = [];
  const addEntry = (
    event: keyof typeof STATUS_COLOR,
    title: string,
    iso: string | null | undefined,
  ) => {
    const instant = iso ? Date.parse(iso) : NaN;
    const absolute = Number.isFinite(instant) ? formatDateTime(iso) : null;
    items.push({
      icon: <Icon icon={STATUS_ICON[event]} size="xs" />,
      title,
      subtitle: absolute ?? '—',
      time: formatRelative(iso),
      color: STATUS_COLOR[event],
      instant,
      absolute,
    });
  };

  if (artifact) {
    addEntry('created', t('admin.gdprExport.lifecycle.created', 'Created'), artifact.created_at);
    if (artifact.downloaded_at?.trim()) {
      addEntry('downloaded', t('admin.gdprExport.downloadTitle', 'Download'), artifact.downloaded_at);
    }
    if (artifact.expires_at?.trim()) {
      const expired = Date.parse(artifact.expires_at) <= now;
      addEntry(
        expired ? 'expired' : 'expires',
        expired
          ? t('admin.gdprExport.lifecycle.expired', 'Expired')
          : t('admin.gdprExport.lifecycle.expires', 'Expires'),
        artifact.expires_at,
      );
    }
    items.sort((a, b) => {
      if (!Number.isFinite(a.instant)) return Number.isFinite(b.instant) ? 1 : 0;
      if (!Number.isFinite(b.instant)) return -1;
      return a.instant - b.instant;
    });
  }

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)} aria-busy={showLoading}>
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Icon icon={Clock} className={typography.color.muted} />
        {label}
      </PanelTitle>
      {showLoading ? (
        <Skeleton height={140} />
      ) : items.length > 0 ? (
        <Timeline
          items={items}
          label={label}
          chronology="oldest-first"
          summaryBounds={{ start: items[0]?.absolute, end: items[items.length - 1]?.absolute }}
        />
      ) : (
        // no-action: like GDPRArtifactDetails, this is derived purely from
        // the parent's `artifact` prop — use the lookup input above.
        <EmptyState
          icon={<Icon icon={Clock} size="xl" />}
          message={t('admin.gdprExport.lifecycleEmpty', 'No lifecycle events recorded yet.')}
        />
      )}
    </GlassPanel>
  );
}
