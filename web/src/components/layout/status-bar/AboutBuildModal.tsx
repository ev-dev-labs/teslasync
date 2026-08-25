import { ExternalLink, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '@/components/ui/runtime';
import { openChangelogModal } from '@/hooks/useChangelog';
import { useAboutBuild } from './useAboutBuild';

interface AboutBuildModalProps {
  open: boolean;
  onClose: () => void;
}

export function AboutBuildModal({
  open,
  onClose,
}: AboutBuildModalProps) {
  const { t } = useTranslation();
  const {
    appVersion,
    hasUnseen,
    sha,
    updateAvailable,
    updateCheck,
    uptime,
    versionInfo,
  } = useAboutBuild();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('statusBar.version.modalTitle', 'About this build')}
    >
      <div className="space-y-4 text-sm text-[var(--text-secondary)]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-[var(--text-muted)]">
            {t('statusBar.version.appVersion', 'App version')}
          </dt>
          <dd className="font-mono text-[var(--text-primary)]">
            v{appVersion}
          </dd>

          <dt className="text-[var(--text-muted)]">
            {t('statusBar.version.commit', 'Commit')}
          </dt>
          <dd className="font-mono text-[var(--text-primary)]">{sha}</dd>

          {versionInfo?.chart_version &&
            versionInfo.chart_version !== 'unknown' && (
              <>
                <dt className="text-[var(--text-muted)]">
                  {t('statusBar.version.chart', 'Helm chart')}
                </dt>
                <dd className="font-mono text-[var(--text-primary)]">
                  v{versionInfo.chart_version}
                </dd>
              </>
            )}

          {versionInfo?.go_version && (
            <>
              <dt className="text-[var(--text-muted)]">
                {t('statusBar.version.go', 'Go runtime')}
              </dt>
              <dd className="font-mono text-[var(--text-primary)]">
                {versionInfo.go_version}
              </dd>
            </>
          )}

          {(versionInfo?.os || versionInfo?.arch) && (
            <>
              <dt className="text-[var(--text-muted)]">
                {t('statusBar.version.platform', 'Platform')}
              </dt>
              <dd className="font-mono text-[var(--text-primary)]">
                {[versionInfo?.os, versionInfo?.arch]
                  .filter(Boolean)
                  .join('/')}
              </dd>
            </>
          )}

          {uptime && (
            <>
              <dt className="text-[var(--text-muted)]">
                {t('statusBar.version.uptimeLabel', 'Server uptime')}
              </dt>
              <dd className="text-[var(--text-primary)]">{uptime}</dd>
            </>
          )}
        </dl>

        {updateAvailable && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-amber-200">
            <p className="text-sm font-medium">
              {t(
                'statusBar.version.updateBanner',
                'A newer release is available',
              )}
              {updateCheck?.latest ? `: v${updateCheck.latest}` : ''}
            </p>
            {updateCheck?.message && (
              <p className="mt-1 text-xs text-amber-100/80">
                {updateCheck.message}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
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
          <Button onClick={onClose}>
            <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('statusBar.version.close', 'Close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
