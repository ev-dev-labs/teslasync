import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag } from 'lucide-react';
import { Tooltip, Button } from '@/components/ui/runtime';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { severityTokens, typography } from '@/lib/tokens';
import { AboutBuildModal } from './AboutBuildModal';
import { useAboutBuild } from './useAboutBuild';

/**
 * VersionSegment.
 *
 * About/build control used inside the status bar's Help menu. The legacy
 * `status` presentation remains available for isolated consumers and tests;
 * both variants open the same provenance modal.
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
  variant?: 'status' | 'menu';
  aboutOpen?: boolean;
  onOpenAbout?: () => void;
}

export function VersionSegment({
  iconOnly = false,
  variant = 'status',
  aboutOpen,
  onOpenAbout,
}: VersionSegmentProps) {
  const { t } = useTranslation();
  const [localOpen, setLocalOpen] = useState(false);
  const {
    appVersion,
    hasUnseen,
    unseenCount,
    sha,
    updateAvailable,
    uptime,
  } = useAboutBuild();
  const managedExternally = onOpenAbout != null;
  const open = managedExternally ? !!aboutOpen : localOpen;
  const openAbout = () => {
    if (onOpenAbout) {
      onOpenAbout();
    } else {
      setLocalOpen(true);
    }
  };

  const tooltip = (
    <span>
      {t('statusBar.version.tooltip', 'TeslaSync version')} · v{appVersion}
      {sha && sha !== 'dev' ? ` · ${sha}` : ''}
      {uptime ? ` · ${t('statusBar.version.uptime', 'up {{uptime}}', { uptime })}` : ''}
      {hasUnseen ? ` · ${t('changelog.unseenHint', '{{count}} new release(s)', { count: unseenCount })}` : ''}
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
      {variant === 'menu' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={openAbout}
          className={cn(
            'h-auto min-h-9 w-full min-w-0 justify-start px-3 py-2',
            typography.color.secondary,
          )}
          data-testid="status-bar-about-trigger"
        >
          <Icon icon={Tag} size="sm" />
          <span className={cn('min-w-0 break-words text-start', typography.weight.medium)}>
            {t('statusBar.help.about', 'About TeslaSync')}
          </span>
          <span className={cn('ms-auto min-w-0 break-words', typography.role.caption)}>
            v{appVersion}
          </span>
          {(updateAvailable || hasUnseen) && (
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                updateAvailable ? severityTokens.warn.dot : severityTokens.info.dot,
              )}
              aria-hidden
            />
          )}
        </Button>
      ) : (
        <Tooltip content={tooltip} side="top">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={ariaLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={openAbout}
            className={cn(
              'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 leading-none',
              typography.role.caption,
            )}
          >
            <Icon icon={Tag} size="xs" />
            {!iconOnly && (
              <>
                <span className={cn(typography.weight.medium, typography.color.secondary)}>v{appVersion}</span>
                {sha && sha !== 'dev' && <span>· {sha}</span>}
                {updateAvailable && (
                  <span
                    className={cn('ms-1 inline-block h-1.5 w-1.5 rounded-full', severityTokens.warn.dot)}
                    aria-hidden="true"
                  />
                )}
                {hasUnseen && !updateAvailable && (
                  <span
                    className={cn('ms-1 inline-block h-1.5 w-1.5 rounded-full', severityTokens.info.dot)}
                    aria-hidden="true"
                  />
                )}
              </>
            )}
          </Button>
        </Tooltip>
      )}

      {!managedExternally && open && (
        <AboutBuildModal
          open
          onClose={() => setLocalOpen(false)}
        />
      )}
    </>
  );
}
