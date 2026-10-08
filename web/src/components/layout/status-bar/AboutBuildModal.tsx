import { ExternalLink, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '@/components/ui/runtime';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Typography';
import { openChangelogModal } from '@/hooks/useChangelogStatus';
import { cn } from '@/lib/cn';
import { severityTokens } from '@/lib/tokens';
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
      <div className="min-w-0 space-y-4">
        <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <Text as="dt" variant="bodySm">
            {t('statusBar.version.appVersion', 'App version')}
          </Text>
          <Text as="dd" variant="body" mono className="min-w-0 break-words">
            v{appVersion}
          </Text>

          <Text as="dt" variant="bodySm">
            {t('statusBar.version.commit', 'Commit')}
          </Text>
          <Text as="dd" variant="body" mono className="min-w-0 break-words">{sha}</Text>

          {versionInfo?.chart_version &&
            versionInfo.chart_version !== 'unknown' && (
              <>
                <Text as="dt" variant="bodySm">
                  {t('statusBar.version.chart', 'Helm chart')}
                </Text>
                <Text as="dd" variant="body" mono className="min-w-0 break-words">
                  v{versionInfo.chart_version}
                </Text>
              </>
            )}

          {versionInfo?.go_version && (
            <>
              <Text as="dt" variant="bodySm">
                {t('statusBar.version.go', 'Go runtime')}
              </Text>
              <Text as="dd" variant="body" mono className="min-w-0 break-words">
                {versionInfo.go_version}
              </Text>
            </>
          )}

          {(versionInfo?.os || versionInfo?.arch) && (
            <>
              <Text as="dt" variant="bodySm">
                {t('statusBar.version.platform', 'Platform')}
              </Text>
              <Text as="dd" variant="body" mono className="min-w-0 break-words">
                {[versionInfo?.os, versionInfo?.arch]
                  .filter(Boolean)
                  .join('/')}
              </Text>
            </>
          )}

          {uptime && (
            <>
              <Text as="dt" variant="bodySm">
                {t('statusBar.version.uptimeLabel', 'Server uptime')}
              </Text>
              <Text as="dd" variant="body" className="min-w-0 break-words">{uptime}</Text>
            </>
          )}
        </dl>

        {updateAvailable && (
          <div className={cn('min-w-0 rounded-shape-sm border p-3', severityTokens.warn.bg, severityTokens.warn.border)}>
            <Text as="p" variant="body" className="break-words">
              {t(
                'statusBar.version.updateBanner',
                'A newer release is available',
              )}
              {updateCheck?.latest ? `: v${updateCheck.latest}` : ''}
            </Text>
            {updateCheck?.message && (
              <Text as="p" variant="bodySm" className="mt-1 break-words">
                {updateCheck.message}
              </Text>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            wrapLabel
            className="min-h-11 md:min-h-10"
            icon={<Icon icon={Sparkles} size="sm" />}
            onClick={() => {
              onClose();
              openChangelogModal();
            }}
          >
            {t('changelog.openModal', "What's new")}
            {hasUnseen && (
              <span
                className={cn('ms-1.5 inline-block h-1.5 w-1.5 rounded-full', severityTokens.info.dot)}
                aria-hidden
              />
            )}
          </Button>
          <Button
            variant="ghost"
            wrapLabel
            className="min-h-11 md:min-h-10"
            icon={<Icon icon={ExternalLink} size="sm" />}
            onClick={() =>
              window.open(
                'https://github.com/ev-dev-labs/teslasync/releases',
                '_blank',
                'noopener,noreferrer',
              )
            }
          >
            {t('statusBar.version.changelog', 'Release notes')}
          </Button>
          <Button
            onClick={onClose}
            wrapLabel
            className="min-h-11 md:min-h-10"
            icon={<Icon icon={X} size="sm" />}
          >
            {t('statusBar.version.close', 'Close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
