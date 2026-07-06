import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionSegment } from './status-bar/ConnectionSegment';
import { LiveTelemetrySegment } from './status-bar/LiveTelemetrySegment';
import { ActiveVehicleSegment } from './status-bar/ActiveVehicleSegment';
import { BackgroundWorkSegment } from './status-bar/BackgroundWorkSegment';
import { VersionSegment } from './status-bar/VersionSegment';
import { HelpSegment } from './status-bar/HelpSegment';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

/**
 * StatusBar.
 *
 * Always-on 28px footer pinned to the bottom of the viewport with five
 * consolidated status segments:
 *
 *   API · Live telemetry · Active vehicle · Background jobs · Version
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
 *   - The root carries `role="status"` + `aria-live="polite"` so screen
 *     readers announce notable transitions (offline ↔ online) without
 *     interrupting other reading flow.
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

  if (!prefs.enabled) return null;

  const iconOnly = compact || prefs.iconOnly || isNarrow;

  return (
    // `<footer>` exposes a `contentinfo` landmark so screen-reader
    // landmark navigation (e.g. JAWS Insert+F7) lists the
    // status bar alongside <header>/<aside>/<main>. The `role="status"`
    // override + `aria-live="polite"` still announce live updates
    // (connection drops, vehicle changes) without losing the landmark
    // affordance because role overrides are permitted by ARIA 1.2.
    <footer
      role="status"
      aria-live="polite"
      data-role="status-bar"
      data-print-hide
      className={cn(
        // Footer is fixed-position so it lives outside the flexbox layout
        // and can sit above the mobile tab bar without needing to know
        // anything about its parent.
        'fixed left-0 right-0 z-[55] flex items-center justify-between gap-2',
        'border-t border-[var(--glass-border)] bg-[var(--surface-1)]/95 backdrop-blur-xl',
        'px-3 lg:px-4 text-xs text-[var(--text-secondary)]',
        // Stack above the BottomTabBar on mobile (which is `bottom-0 h-14`),
        // on desktop go all the way to the bottom.
        'bottom-14 lg:bottom-0',
        // 24px on mobile (denser), 28px on desktop. Padding matches.
        'h-6 lg:h-7',
        className,
      )}
      aria-label={t('statusBar.aria', 'Application status')}
    >
      <div className="flex min-w-0 items-center gap-1">
        <ConnectionSegment iconOnly={iconOnly} />
        <Divider />
        <LiveTelemetrySegment iconOnly={iconOnly} />
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <BackgroundWorkSegment iconOnly={iconOnly} />
        {/* Background work segment is conditional; only render the divider
            when it's present (it returns null when there are no jobs). The
            ActiveVehicleSegment, in turn, is hidden when the fleet has 0
            vehicles. We always render the dividers around segments that
            unconditionally render to keep the layout stable. */}
        <ActiveVehicleSegment iconOnly={iconOnly} />
        <Divider />
        <HelpSegment iconOnly={iconOnly} />
        <Divider />
        <VersionSegment iconOnly={iconOnly} />
      </div>
    </footer>
  );
}

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-white/[0.08]" aria-hidden />;
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
