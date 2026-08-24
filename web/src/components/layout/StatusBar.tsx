import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionSegment } from './status-bar/ConnectionSegment';
import { LiveTelemetrySegment } from './status-bar/LiveTelemetrySegment';
import { ActiveVehicleSegment } from './status-bar/ActiveVehicleSegment';
import { AlertsSegment } from './status-bar/AlertsSegment';
import { BackgroundWorkSegment } from './status-bar/BackgroundWorkSegment';
import { RecentPagesSegment } from './status-bar/RecentPagesSegment';
import { HelpSegment } from './status-bar/HelpSegment';
import { MoreSegment } from './status-bar/MoreSegment';
import { AboutBuildModal } from './status-bar/AboutBuildModal';
import {
  StatusBarProvider,
  useStatusBarAnnouncer,
} from './status-bar/StatusBarContext';
import {
  useBackgroundJobs,
  type UseBackgroundJobsResult,
} from '@/hooks/useBackgroundJobs';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

/**
 * StatusBar.
 *
 * Always-on 28px footer pinned to the bottom of the viewport with prioritized
 * status segments:
 *
 *   API · Live telemetry · Alerts · Recent pages · Background jobs · Active vehicle · Help/About
 *
 * Each segment is its own component (in `./status-bar/`) and is fed by a
 * dedicated hook so subscribers don't pay for the whole bar.
 *
 * Visibility & sizing:
 *   - On screens < `lg` (Tailwind 1024px) the bar collapses to icon-only,
 *     stacks ABOVE the `<BottomTabBar>`, and is shorter (24px vs 28px).
 *   - The `compact` prop forces icon-only at any width.
 *   - User preference (`useStatusBarPrefs`) can hide the bar entirely or
 *     force icon-only at all widths.
 *   - Hidden in print stylesheets via `data-role="status-bar"` (rule lives
 *     in `web/src/index.css`).
 *
 * Accessibility:
 *   - The root remains a normal footer landmark. A separate visually-hidden
 *     live region announces meaningful transitions without making every
 *     interactive control part of one large live region.
 *   - Color is never the sole encoder — every segment pairs color with an
 *     icon variation per state.
 */

export interface StatusBarProps {
  /** Force every segment into its icon-only variant. */
  compact?: boolean;
  className?: string;
}

export function StatusBar({ compact = false, className }: StatusBarProps) {
  const { t } = useTranslation();
  const prefs = useStatusBarPrefs();
  // Track viewport width so we can swap to icon-only on narrow screens
  // without a Tailwind variant blow-up. The threshold matches the same
  // `lg` (1024px) breakpoint Tailwind already uses for the sidebar.
  const isNarrow = useNarrowViewport();
  const showOverflow = useMediaQuery('(max-width: 1279px)');

  if (!prefs.enabled) return null;

  const iconOnly = compact || prefs.iconOnly || isNarrow;

  return (
    <StatusBarProvider
      announcementLabel={t(
        'statusBar.announcements',
        'Application status announcements',
      )}
    >
      <StatusBarContent
        iconOnly={iconOnly}
        showOverflow={showOverflow}
        className={className}
      />
    </StatusBarProvider>
  );
}

interface StatusBarContentProps {
  iconOnly: boolean;
  showOverflow: boolean;
  className?: string;
}

function StatusBarContent({
  iconOnly,
  showOverflow,
  className,
}: StatusBarContentProps) {
  const { t } = useTranslation();
  const backgroundJobs = useBackgroundJobs();
  const [aboutOpen, setAboutOpen] = useState(false);
  useBackgroundFailureAnnouncements(backgroundJobs);

  return (
    <>
      <footer
        data-role="status-bar"
        data-print-hide
        className={cn(
          'fixed left-0 right-0 z-[55] flex items-center justify-between gap-2',
          'border-t border-[var(--glass-border)] bg-[var(--surface-1)]/95 backdrop-blur-xl',
          'px-3 text-xs text-[var(--text-secondary)] lg:px-4',
          'bottom-14 lg:bottom-0',
          'h-6 lg:h-7',
          className,
        )}
        aria-label={t('statusBar.aria', 'Application status')}
      >
        <div className="flex min-w-0 items-center gap-1">
          <ConnectionSegment
            iconOnly={iconOnly}
            enableAdminDiagnostics
          />
          <Divider />
          <LiveTelemetrySegment iconOnly={iconOnly} />
          <AlertsSegment iconOnly={iconOnly} />
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <RecentPagesSegment iconOnly={iconOnly} />
          <Divider />
          {showOverflow ? (
            <MoreSegment
              iconOnly={iconOnly}
              backgroundJobs={backgroundJobs}
              onOpenAbout={() => setAboutOpen(true)}
            />
          ) : (
            <>
              <BackgroundWorkSegment
                iconOnly={iconOnly}
                backgroundJobs={backgroundJobs}
              />
              <ActiveVehicleSegment iconOnly={iconOnly} />
              <HelpSegment
                iconOnly={iconOnly}
                onOpenAbout={() => setAboutOpen(true)}
              />
            </>
          )}
        </div>
      </footer>
      {aboutOpen && (
        <AboutBuildModal
          open
          onClose={() => setAboutOpen(false)}
        />
      )}
    </>
  );
}

function useBackgroundFailureAnnouncements({
  jobs,
}: UseBackgroundJobsResult) {
  const announce = useStatusBarAnnouncer();
  const previousErrorIds = useRef(
    new Set(jobs.filter((job) => job.status === 'error').map((job) => job.id)),
  );

  useEffect(() => {
    const current = new Set(
      jobs.filter((job) => job.status === 'error').map((job) => job.id),
    );
    const newError = jobs.find(
      (job) => job.status === 'error' && !previousErrorIds.current.has(job.id),
    );
    if (newError) {
      announce?.(
        `${newError.label}${newError.description ? `: ${newError.description}` : ''}`,
      );
    }
    previousErrorIds.current = current;
  }, [announce, jobs]);
}

function Divider() {
  return (
    <span
      className="h-3 w-px shrink-0 bg-[var(--border-subtle)]"
      aria-hidden
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Viewport breakpoint hook
// ────────────────────────────────────────────────────────────────────────────

/**
 * True when the viewport is narrower than Tailwind's `lg` (1024px) breakpoint —
 * the same threshold the sidebar uses to collapse. Delegates to the shared,
 * SSR/`matchMedia`-safe {@link useMediaQuery} so the status bar never assumes
 * `window.matchMedia` exists: older embedded webviews (and the jsdom test
 * environment) don't provide it, and an unguarded call throws a `TypeError`
 * that would crash the whole shell before the bar could render.
 */
function useNarrowViewport(): boolean {
  return useMediaQuery('(max-width: 1023px)');
}

// ────────────────────────────────────────────────────────────────────────────
// Persisted preferences (localStorage + cross-tab sync)
// ────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'teslasync-status-bar-prefs';

export interface StatusBarPrefs {
  /** Show the status bar at all. Defaults to `true`. */
  enabled: boolean;
  /** Force icon-only mode regardless of viewport width. Defaults to `false`. */
  iconOnly: boolean;
}

const DEFAULTS: StatusBarPrefs = { enabled: true, iconOnly: false };

function readPrefs(): StatusBarPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<StatusBarPrefs>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      iconOnly: typeof parsed.iconOnly === 'boolean' ? parsed.iconOnly : DEFAULTS.iconOnly,
    };
  } catch {
    return DEFAULTS;
  }
}

let cachedPrefs: StatusBarPrefs = readPrefs();
const prefsListeners = new Set<() => void>();

function emitPrefs() {
  for (const fn of prefsListeners) fn();
}

function subscribePrefs(fn: () => void): () => void {
  prefsListeners.add(fn);
  return () => prefsListeners.delete(fn);
}

function getPrefsSnapshot(): StatusBarPrefs {
  return cachedPrefs;
}

if (typeof window !== 'undefined') {
  // Cross-tab sync — when one tab changes the prefs, mirror them in this tab.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    cachedPrefs = readPrefs();
    emitPrefs();
  });
}

/** Reactive read of the persisted status-bar preferences. */
export function useStatusBarPrefs(): StatusBarPrefs {
  return useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getPrefsSnapshot);
}

/** Update one or more preferences and persist them. */
export function setStatusBarPrefs(next: Partial<StatusBarPrefs>): void {
  cachedPrefs = { ...cachedPrefs, ...next };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedPrefs));
    } catch {
      // localStorage unavailable — change still applies in this tab session.
    }
  }
  emitPrefs();
}
