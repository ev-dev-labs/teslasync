import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionSegment } from './status-bar/ConnectionSegment';
import { LiveTelemetrySegment } from './status-bar/LiveTelemetrySegment';
import { HonestyMeterSegment } from './status-bar/HonestyMeterSegment';
import { OperationalModeSegment } from './status-bar/OperationalModeSegment';
import { AlertsSegment } from './status-bar/AlertsSegment';
import { BackgroundWorkSegment } from './status-bar/BackgroundWorkSegment';
import { RecentPagesSegment } from './status-bar/RecentPagesSegment';
import { HelpSegment } from './status-bar/HelpSegment';
import { MoreSegment } from './status-bar/MoreSegment';
import { PresentationModeSegment } from './status-bar/PresentationModeSegment';
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
import { typography } from '@/lib/tokens';
import { Button, Tooltip } from '@/components/ui/runtime';
import { HelixMark } from '@/components/branding/HelixMark';

const HelixSidePanel = lazy(async () => {
  const module = await import('./status-bar/HelixSidePanel');
  return { default: module.HelixSidePanel };
});

/**
 * StatusBar.
 *
 * Always-on footer pinned to the bottom of the viewport. It is ONE row at
 * every width: items never wrap and the bar never scrolls sideways.
 *
 *   API · Live telemetry · honesty · data time · alerts … recent · More · Helix
 *
 * Each segment is its own component (in `./status-bar/`) and is fed by a
 * dedicated hook so subscribers don't pay for the whole bar.
 *
 * Priority overflow (tiers follow the shell's `md`/`xl` breakpoints):
 *   - desktop (>= 1280px): every item with its label; background work,
 *     presentation and help sit inline.
 *   - tablet (768-1279px): API, Live and More keep labels; the remaining
 *     items show icon + status dot only, labels move to tooltips.
 *   - mobile (< 768px): API, Live, alerts and More stay in the bar; telemetry
 *     honesty, data time, recent pages and Helix move into the More menu
 *     with their labels and values.
 *   - compact: last resort when even the mobile row does not fit; API and
 *     Live drop their labels too.
 *   If the row measures wider than the bar at any tier (long translations,
 *   large text), it steps down a tier, so nothing is ever clipped: anything
 *   not in the bar is reachable from More.
 *
 * Geometry: fixed row height (44px below `xl` for touch targets, 28px at
 * `xl`) from `--shell-status-bar-row`; it stacks above `<BottomTabBar>`
 * below `xl` and pads for the bottom safe area whenever it is the lowest
 * bar (see `index.css`). Hidden in print via `data-role="status-bar"`.
 *
 * Preferences (`useStatusBarPrefs`) can hide the bar entirely or force
 * icon-only labels; the `compact` prop forces icon-only too.
 *
 * Accessibility:
 *   - The root remains a normal footer landmark. A separate visually-hidden
 *     live region announces meaningful transitions without making every
 *     interactive control part of one large live region.
 *   - Color is never the sole encoder: every segment pairs color with an
 *     icon variation per state, and every icon-only item has a tooltip and
 *     an accessible name.
 */

export interface StatusBarProps {
  /** Force every segment into its icon-only variant. */
  compact?: boolean;
  className?: string;
}

export function StatusBar({ compact = false, className }: StatusBarProps) {
  const { t } = useTranslation();
  const prefs = useStatusBarPrefs();
  const viewportTier = useViewportTier();

  if (!prefs.enabled) return null;

  const iconOnly = compact || prefs.iconOnly;

  return (
    <StatusBarProvider
      announcementLabel={t(
        'statusBar.announcements',
        'Application status announcements',
      )}
    >
      <StatusBarContent
        forceIconOnly={iconOnly}
        viewportTier={viewportTier}
        className={className}
      />
    </StatusBarProvider>
  );
}

interface StatusBarContentProps {
  forceIconOnly: boolean;
  viewportTier: StatusBarTier;
  className?: string;
}

function StatusBarContent({
  forceIconOnly,
  viewportTier,
  className,
}: StatusBarContentProps) {
  const { t } = useTranslation();
  const backgroundJobs = useBackgroundJobs();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helixOpen, setHelixOpen] = useState(false);
  const [helixMounted, setHelixMounted] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const tier = useFittedTier(viewportTier, rowRef);
  useBackgroundFailureAnnouncements(backgroundJobs);

  const primaryIconOnly = forceIconOnly || tier === 'compact';
  const secondaryIconOnly = forceIconOnly || tier !== 'desktop';
  const overflowStatus = tier === 'mobile' || tier === 'compact';
  const showOverflow = tier !== 'desktop';
  const openHelix = () => {
    setHelixMounted(true);
    setHelixOpen(true);
  };

  return (
    <>
      <footer
        data-role="status-bar"
        data-print-hide
        data-status-tier={tier}
        className={cn(
          'fixed left-0 right-0 z-shell-status-bar',
          'border-t border-[var(--border-default)] bg-[var(--surface-1)]',
          'px-3 pb-[var(--shell-status-bar-safe-area)] lg:px-4',
          typography.size.xs,
          typography.color.secondary,
          'bottom-[var(--shell-tab-bar-height)] xl:bottom-0',
          'h-[var(--shell-status-bar-height)]',
          className,
        )}
        aria-label={t('statusBar.aria', 'Application status')}
      >
        <div
          ref={rowRef}
          data-testid="status-bar-row"
          className="flex h-[var(--shell-status-bar-row)] min-w-0 flex-nowrap items-center justify-between gap-2 xl:gap-3"
        >
          <div
            role="group"
            aria-label={t('statusBar.aria', 'Application status')}
            className="flex shrink-0 flex-nowrap items-center gap-2 xl:gap-3"
          >
            <ConnectionSegment
              iconOnly={primaryIconOnly}
              enableAdminDiagnostics
            />
            <LiveTelemetrySegment iconOnly={primaryIconOnly} />
            {!overflowStatus && (
              <>
                <Divider />
                <HonestyMeterSegment iconOnly={secondaryIconOnly} />
                <OperationalModeSegment iconOnly={secondaryIconOnly} />
              </>
            )}
            <AlertsSegment iconOnly={secondaryIconOnly} />
          </div>
          <div
            role="group"
            aria-label={t('statusBar.aria', 'Application status')}
            className="flex shrink-0 flex-nowrap items-center gap-2 xl:gap-3"
          >
            {!overflowStatus && (
              <>
                <RecentPagesSegment iconOnly={secondaryIconOnly} />
                <Divider />
              </>
            )}
            {showOverflow ? (
              <MoreSegment
                iconOnly={primaryIconOnly}
                backgroundJobs={backgroundJobs}
                onOpenAbout={() => setAboutOpen(true)}
                overflowStatus={overflowStatus}
                onOpenHelix={openHelix}
              />
            ) : (
              <>
                <BackgroundWorkSegment
                  iconOnly={secondaryIconOnly}
                  backgroundJobs={backgroundJobs}
                />
                <PresentationModeSegment iconOnly={secondaryIconOnly} />
                <HelpSegment
                  iconOnly={secondaryIconOnly}
                  onOpenAbout={() => setAboutOpen(true)}
                />
              </>
            )}
            {!overflowStatus && (
              <>
                <Divider />
                <Tooltip content={t('statusBar.helix.open', 'Open Helix chat')} side="top">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('statusBar.helix.open', 'Open Helix chat')}
                    aria-expanded={helixOpen}
                    onClick={() => {
                      setHelixMounted(true);
                      setHelixOpen(value => !value);
                    }}
                    className={cn('h-11 min-h-11 min-w-11 shrink-0 rounded px-1.5 py-0 xl:h-5 xl:min-h-0 xl:min-w-0', typography.color.secondary)}
                  >
                    <HelixMark className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </footer>
      {aboutOpen && (
        <AboutBuildModal
          open
          onClose={() => setAboutOpen(false)}
        />
      )}
      {helixMounted && (
        <Suspense fallback={null}>
          <HelixSidePanel open={helixOpen} onClose={() => setHelixOpen(false)} />
        </Suspense>
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
      className="hidden h-3 w-px shrink-0 bg-[var(--border-subtle)] md:block"
      aria-hidden
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Width tiers
// ────────────────────────────────────────────────────────────────────────────

/** Ordered from most to least compact; see the component doc for each tier. */
const STATUS_BAR_TIERS = ['compact', 'mobile', 'tablet', 'desktop'] as const;
export type StatusBarTier = (typeof STATUS_BAR_TIERS)[number];

/**
 * Tier from the viewport, using the shell's `md` (768px) and `xl` (1280px)
 * breakpoints. Delegates to the SSR/`matchMedia`-safe {@link useMediaQuery}
 * so environments without `window.matchMedia` (older webviews, jsdom) fall
 * back to the desktop tier instead of throwing.
 */
function useViewportTier(): StatusBarTier {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(max-width: 1279px)');
  return isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
}

/**
 * Steps down from the viewport tier while the row is wider than the bar.
 * The width each tier needed is remembered, so a tier is only restored once
 * the bar is at least that wide again, with no flip-flopping between tiers.
 */
function useFittedTier(
  preferred: StatusBarTier,
  rowRef: RefObject<HTMLElement | null>,
): StatusBarTier {
  const [width, setWidth] = useState(0);
  const [neededWidth, setNeededWidth] = useState<Partial<Record<StatusBarTier, number>>>({});

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setWidth(row.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, [rowRef]);

  let index = STATUS_BAR_TIERS.indexOf(preferred);
  while (index > 0 && width > 0 && width < (neededWidth[STATUS_BAR_TIERS[index]] ?? 0)) {
    index -= 1;
  }
  const tier = STATUS_BAR_TIERS[index];

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || index === 0 || row.clientWidth === 0) return;
    // Sum the item groups' own boxes rather than `scrollWidth`, which also
    // counts absolutely positioned descendants such as tooltip bubbles.
    const groups = Array.from(row.children) as HTMLElement[];
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    const needed = groups.reduce((sum, group) => sum + group.getBoundingClientRect().width, 0)
      + gap * Math.max(0, groups.length - 1);
    if (needed > row.clientWidth + 1) {
      setNeededWidth(previous => (
        (previous[tier] ?? 0) >= needed ? previous : { ...previous, [tier]: needed }
      ));
    }
  });

  return tier;
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
