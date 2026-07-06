import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, HelpCircle, Keyboard } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry';
import { cn } from '@/lib/cn';

/**
 * HelpSegment — footer status-bar segment that consolidates the three
 * "always available" help affordances that used to live at the bottom of
 * the sidebar:
 *
 *   • Press `?` for shortcuts → opens the keyboard cheat sheet
 *   • Take a tour              → opens the tour launcher
 *   • Report bug               → opens the in-app feedback modal
 *
 * Each action stays decoupled from the React tree by dispatching the same
 * window events the sidebar previously used (`toggle-keyboard-shortcuts`,
 * `dispatchTourLauncherOpen()`, and `open-feedback-modal`), so the Cmd+K
 * palette and any other surface continue to work unchanged.
 *
 * Visibility:
 *   - Full label + icon when the bar is in expanded mode.
 *   - Icon-only with tooltips when the bar is compact / on narrow screens.
 */

export interface HelpSegmentProps {
  iconOnly?: boolean;
}

const buttonClass = cn(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-none',
  'text-[var(--text-muted)] hover:bg-white/[0.04] hover:text-[var(--text-secondary)]',
  'focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
);

export function HelpSegment({ iconOnly = false }: HelpSegmentProps) {
  const { t } = useTranslation();

  // Stable dispatchers — each fires the same decoupled window event Layout
  // listens for and never depends on props/state, so we memoise once per mount
  // rather than recreating a closure on every status-bar re-render.
  const openShortcuts = useCallback(
    () => window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts')),
    [],
  );
  const openTour = useCallback(() => dispatchTourLauncherOpen(), []);
  const openFeedback = useCallback(
    () => window.dispatchEvent(new CustomEvent('open-feedback-modal')),
    [],
  );

  return (
    <div className="flex items-center gap-1" data-tour="keyboard-hint">
      <Tooltip content={t('shortcuts.tooltip', 'Keyboard shortcuts')} side="top">
        <button
          type="button"
          onClick={openShortcuts}
          className={buttonClass}
          aria-label={t('shortcuts.openAria', 'Open keyboard shortcuts')}
        >
          <Keyboard className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <>
              <kbd className="rounded bg-[var(--surface-2)] px-1 text-2xs text-[var(--text-secondary)]">?</kbd>
              <span className="hidden xl:inline">{t('shortcuts.hintSuffix', 'for shortcuts')}</span>
            </>
          )}
        </button>
      </Tooltip>

      <Tooltip content={t('tour.launcher.openShort', 'Take a tour')} side="top">
        <button
          type="button"
          onClick={openTour}
          className={buttonClass}
          aria-label={t('tour.launcher.openAria', 'Open tour launcher')}
          data-tour-launcher-trigger
        >
          <HelpCircle className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && <span className="hidden xl:inline">{t('tour.launcher.openShort', 'Take a tour')}</span>}
        </button>
      </Tooltip>

      <Tooltip content={t('feedback.openShort', 'Report bug')} side="top">
        <button
          type="button"
          onClick={openFeedback}
          className={buttonClass}
          aria-label={t('feedback.openAria', 'Open feedback / bug report form')}
          data-testid="status-bar-feedback-trigger"
        >
          <Bug className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && <span className="hidden xl:inline">{t('feedback.openShort', 'Report bug')}</span>}
        </button>
      </Tooltip>
    </div>
  );
}
