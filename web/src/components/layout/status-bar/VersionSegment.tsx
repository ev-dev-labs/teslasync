import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Tag, X, ExternalLink, Sparkles } from 'lucide-react';
import { Tooltip, Modal, Button } from '@/components/ui';
import { request } from '@/api/client';
import type { VersionInfo, UpdateCheckResult } from '@/api/types';
import { cn } from '@/lib/cn';
import { openChangelogModal, useChangelog } from '@/hooks/useChangelog';

/**
 * VersionSegment.
 *
 * Footer status-bar segment that surfaces the running app version + git
 * SHA. Click opens a modal with full version provenance and (when
 * available) an "update available" hint linking to the changelog.
 *
 * Resolution order for the version label:
 *   1. `versionInfo.app_version` from `/system/version`        (server-truth)
 *   2. `import.meta.env.VITE_APP_VERSION` from package.json   (build-time)
 *   3. `'dev'`                                                 (worst case)
 *
 * Resolution order for the short SHA:
 *   1. `import.meta.env.VITE_GIT_SHA` (build-time `git rev-parse --short HEAD`)
 *   2. `'dev'`
 */

interface VersionSegmentProps {
  iconOnly?: boolean;
}

const BUILD_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';
const BUILD_SHA: string = import.meta.env.VITE_GIT_SHA || 'dev';

function uptimeLabel(seconds: number | undefined | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function VersionSegment({ iconOnly = false }: VersionSegmentProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { hasUnseen, newEntries } = useChangelog();

  const { data: versionInfo } = useQuery({
    queryKey: ['version-info'],
    queryFn: () => request<VersionInfo>('/system/version'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: updateCheck } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => request<UpdateCheckResult>('/system/update-check'),
    staleTime: 3_600_000,
    refetchInterval: 3_600_000,
  });

  const appVersion =
    (versionInfo?.app_version && versionInfo.app_version !== 'unknown'
      ? versionInfo.app_version
      : BUILD_VERSION) || 'dev';
  const sha = BUILD_SHA;
  const updateAvailable = !!updateCheck?.update_available;
  const uptime = uptimeLabel(versionInfo?.uptime_seconds);

  const tooltip = (
    <span>
      {t('statusBar.version.tooltip', 'TeslaSync version')} · v{appVersion}
      {sha && sha !== 'dev' ? ` · ${sha}` : ''}
      {uptime ? ` · ${t('statusBar.version.uptime', 'up {{uptime}}', { uptime })}` : ''}
      {hasUnseen ? ` · ${t('changelog.unseenHint', '{{count}} new release(s)', { count: newEntries.length })}` : ''}
    </span>
  );

  // The accessible name is the single source of truth for assistive tech —
  // BOTH the "update available" and "unseen changelog" states must live here.
  // The coloured dots below are decorative (aria-hidden); an aria-label on a
  // role-less <span> is not reliably announced, so relying on the dots alone
  // left the update state invisible to screen-reader users.
  const ariaLabel = `${t('statusBar.version.aria', 'TeslaSync version')}: v${appVersion}${
    sha && sha !== 'dev' ? ` (${sha})` : ''
  }${updateAvailable ? `, ${t('statusBar.version.updateAvailable', 'Update available')}` : ''}${
    hasUnseen ? `, ${t('changelog.unseenAria', 'unseen changelog')}` : ''
  }`;

  return (
    <>
      <Tooltip content={tooltip} side="top">
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
            'text-[var(--text-muted)] hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
          )}
        >
          <Tag className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <>
              <span className="font-medium text-[var(--text-secondary)]">v{appVersion}</span>
              {sha && sha !== 'dev' && <span>· {sha}</span>}
              {updateAvailable && (
                <span
                  className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
                  aria-hidden="true"
                />
              )}
              {hasUnseen && !updateAvailable && (
                <span
                  className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400"
                  aria-hidden="true"
                />
              )}
            </>
          )}
        </button>
      </Tooltip>

      <Modal open={open} onClose={() => setOpen(false)} title={t('statusBar.version.modalTitle', 'About this build')}>
        <div className="space-y-4 text-sm text-[var(--text-secondary)]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-[var(--text-muted)]">{t('statusBar.version.appVersion', 'App version')}</dt>
            <dd className="font-mono text-[var(--text-primary)]">v{appVersion}</dd>

            <dt className="text-[var(--text-muted)]">{t('statusBar.version.commit', 'Commit')}</dt>
            <dd className="font-mono text-[var(--text-primary)]">{sha}</dd>

            {versionInfo?.chart_version && versionInfo.chart_version !== 'unknown' && (
              <>
                <dt className="text-[var(--text-muted)]">{t('statusBar.version.chart', 'Helm chart')}</dt>
                <dd className="font-mono text-[var(--text-primary)]">v{versionInfo.chart_version}</dd>
              </>
            )}

            {versionInfo?.go_version && (
              <>
                <dt className="text-[var(--text-muted)]">{t('statusBar.version.go', 'Go runtime')}</dt>
                <dd className="font-mono text-[var(--text-primary)]">{versionInfo.go_version}</dd>
              </>
            )}

            {(versionInfo?.os || versionInfo?.arch) && (
              <>
                <dt className="text-[var(--text-muted)]">{t('statusBar.version.platform', 'Platform')}</dt>
                <dd className="font-mono text-[var(--text-primary)]">
                  {[versionInfo?.os, versionInfo?.arch].filter(Boolean).join('/')}
                </dd>
              </>
            )}

            {uptime && (
              <>
                <dt className="text-[var(--text-muted)]">{t('statusBar.version.uptimeLabel', 'Server uptime')}</dt>
                <dd className="text-[var(--text-primary)]">{uptime}</dd>
              </>
            )}
          </dl>

          {updateAvailable && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-amber-200">
              <p className="text-sm font-medium">
                {t('statusBar.version.updateBanner', 'A newer release is available')}
                {updateCheck?.latest ? `: v${updateCheck.latest}` : ''}
              </p>
              {updateCheck?.message && (
                <p className="mt-1 text-xs text-amber-100/80">{updateCheck.message}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                openChangelogModal();
              }}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t('changelog.openModal', "What's new")}
              {hasUnseen && (
                <span
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400"
                  aria-hidden
                />
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                window.open(
                  'https://github.com/ev-dev-labs/teslasync/releases',
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t('statusBar.version.changelog', 'Release notes')}
            </Button>
            <Button onClick={() => setOpen(false)}>
              <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t('statusBar.version.close', 'Close')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
