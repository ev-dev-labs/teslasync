import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag } from 'lucide-react';
import { Tooltip, Button } from '@/components/ui/runtime';
import { cn } from '@/lib/cn';
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
    newEntries,
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
      {variant === 'menu' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={openAbout}
          className="h-auto min-h-9 w-full justify-start px-3 py-2 text-[var(--text-secondary)]"
          data-testid="status-bar-about-trigger"
        >
          <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="font-medium">
            {t('statusBar.help.about', 'About TeslaSync')}
          </span>
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            v{appVersion}
          </span>
          {(updateAvailable || hasUnseen) && (
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                updateAvailable ? 'bg-amber-400' : 'bg-cyan-400',
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
              'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs leading-none',
              'text-[var(--text-muted)]',
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
