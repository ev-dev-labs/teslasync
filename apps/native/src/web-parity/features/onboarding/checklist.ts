/**
 * First-run onboarding checklist.
 *
 * Tracks whether the user has actually configured the things that make
 * TeslaSync useful. Distinct from `OnboardingWizard` (one-shot intro slides)
 * and the empty-fleet placeholder — this surface remains visible until the
 * user has completed the setup steps (or explicitly dismissed it).
 *
 * Design notes (preserved from the web source):
 *   - Each task is observable from existing client state (no new backend
 *     persistence). When the underlying state flips, the task's `complete`
 *     boolean flips on the next render of `useChecklistTasks`.
 *   - The `useChecklistTasks` hook calls every dependency hook (vehicles,
 *     theme, alert rules, notification channels) in a fixed order so that
 *     the rules of hooks are respected even when tasks are gated by
 *     `show()` predicates.
 *   - "Discovered" flags live in storage so they survive UI churn without
 *     needing a server round-trip.
 *
 * React Native parity port of web/src/features/onboarding/checklist.ts.
 *
 * Browser-only dependencies are reduced explicitly (see the `.parity.json`
 * sidecar + `nativeChecklistCapabilities`):
 *   - `localStorage`: React Native has no localStorage and this app does not
 *     depend on AsyncStorage/MMKV, so flags are kept in a module-level
 *     in-memory `Map`. State survives within a running session but resets on a
 *     full app reload (explicit unavailable state). The storage keys are kept
 *     identical to web so the parity intent is preserved.
 *   - `window` `CustomEvent` / `storage` / `focus` listeners: the same-surface
 *     change notification becomes an in-process listener bus
 *     (`subscribeChecklistChange`); the cross-tab `storage` event has no native
 *     analog (single surface); window `focus` re-reads map to `AppState`
 *     becoming `active`; the 5s polling tick is preserved verbatim.
 *   - `Notification` + `navigator.serviceWorker` web push: browser-only, so
 *     `isWebPushAvailable()` / push-granted detection report `false` on native
 *     (native push would use FCM/APNs, which is not wired up here).
 *   - `lucide-react` icon components (`LucideIcon`): replaced by native-safe
 *     decorative glyph strings (the established inline-lucide parity approach),
 *     keyed by the original icon name so the web→native mapping stays explicit.
 *   - `react-i18next` `useTranslation`: replaced by a native-safe `t` fallback;
 *     the hook is still called (and `t` still `void`-ed) so the fixed hook
 *     order + i18n intent are preserved. Every translation key is retained on
 *     the task objects.
 *   - `@/components/ui/ThemeProvider` `useTheme`: no native ThemeProvider yet,
 *     so a minimal native-safe `themeId` reader is reproduced locally (reads
 *     the same `teslasync-theme` key, defaults to `neon-cyan`). Native theme
 *     selection is not wired up yet, so the "pick a theme" task stays
 *     incomplete until a native theme store writes that key.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {AppState, type AppStateStatus} from 'react-native';

import {useVehicles} from '../../api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationChannels,
} from '../../api/hooks/useNotifications';

/* ─── storage keys ──────────────────────────────────────────────────────── */

export const CP_DISCOVERED_KEY = 'teslasync:cp-discovered';
export const CHECKLIST_DISMISSED_KEY = 'teslasync:checklist:dismissed';
export const CHECKLIST_COMPLETED_AT_KEY = 'teslasync:checklist:completed-at';
/**
 * Flips to '1' once the user adds their first widget via the dashboard
 * widget catalogue. Drives the `customize-dashboard`
 * checklist task. Stored client-side because there's no backend signal that
 * differentiates "user added a widget" from "user accepted the seeded
 * default layout".
 */
export const CUSTOMIZE_DASHBOARD_KEY = 'teslasync:checklist:customizeDashboard';

/** Logical change-channel name emitted when checklist-related storage flags
 * change so the widget can re-read state. On web this was a DOM `CustomEvent`
 * type; on native it identifies the in-process change bus below. */
export const CHECKLIST_CHANGED_EVENT = 'teslasync:checklist:changed';

/** Default theme id — selecting any other theme counts as "picked a theme". */
const DEFAULT_THEME_ID = 'neon-cyan';

/** Storage key the (web) ThemeProvider persists the selected theme under. */
const THEME_STORAGE_KEY = 'teslasync-theme';

/* ─── native-safe storage (web parity for localStorage) ─────────────────── */

// React Native has no localStorage and this app does not depend on
// AsyncStorage/MMKV, so checklist flags live in a module-level in-memory map.
// Flags therefore reset on a full app reload — see `nativeChecklistCapabilities`.
const memoryStore = new Map<string, string>();

type ChecklistChangeListener = () => void;
const changeListeners = new Set<ChecklistChangeListener>();

/** Notifies in-process subscribers that a checklist flag changed (native-safe
 * replacement for `window.dispatchEvent(new CustomEvent(...))`). */
function emitChecklistChange(): void {
  changeListeners.forEach(listener => {
    try {
      listener();
    } catch {
      // A misbehaving listener must never break a storage write.
    }
  });
}

/**
 * Subscribe to same-surface checklist flag changes. Returns an unsubscribe
 * function. Native-safe replacement for the web `CHECKLIST_CHANGED_EVENT`
 * window listener.
 */
export function subscribeChecklistChange(
  listener: ChecklistChangeListener,
): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function safeRead(key: string): string | null {
  try {
    return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string | null): void {
  try {
    if (value === null) {
      memoryStore.delete(key);
    } else {
      memoryStore.set(key, value);
    }
    emitChecklistChange();
  } catch {
    // Defensive parity with the web no-op: a storage failure must not crash
    // the surfacing UI. The widget still renders the in-memory tasks list.
  }
}

/* ─── Command-palette discovery instrumentation ─────────────────────────── */

/**
 * Record that the user has opened the command palette at least once. Safe to
 * call repeatedly — only writes the flag the first time. Intended to be
 * invoked from the CommandPalette open effect.
 */
export function markCommandPaletteDiscovered(): void {
  if (safeRead(CP_DISCOVERED_KEY)) {
    return;
  }
  safeWrite(CP_DISCOVERED_KEY, '1');
}

export function isCommandPaletteDiscovered(): boolean {
  return safeRead(CP_DISCOVERED_KEY) === '1';
}

/* ─── Customize-dashboard discovery instrumentation ─────────────────────── */

/**
 * Record that the user has added at least one widget through the dashboard
 * widget catalogue. Idempotent — only writes the first time.
 */
export function markCustomizeDashboardCompleted(): void {
  if (safeRead(CUSTOMIZE_DASHBOARD_KEY)) {
    return;
  }
  safeWrite(CUSTOMIZE_DASHBOARD_KEY, '1');
}

export function isCustomizeDashboardCompleted(): boolean {
  return safeRead(CUSTOMIZE_DASHBOARD_KEY) === '1';
}

/* ─── Dismiss / restart helpers ─────────────────────────────────────────── */

export function isChecklistDismissed(): boolean {
  return safeRead(CHECKLIST_DISMISSED_KEY) === '1';
}

export function setChecklistDismissed(dismissed: boolean): void {
  safeWrite(CHECKLIST_DISMISSED_KEY, dismissed ? '1' : null);
}

/** Used by the widget to celebrate completion for 24h before going quiet. */
export function getChecklistCompletedAt(): number | null {
  const raw = safeRead(CHECKLIST_COMPLETED_AT_KEY);
  if (!raw) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setChecklistCompletedAt(ms: number | null): void {
  safeWrite(CHECKLIST_COMPLETED_AT_KEY, ms == null ? null : String(ms));
}

/** Clears all checklist state — used by the Settings "Restart" affordance. */
export function restartChecklist(): void {
  setChecklistDismissed(false);
  setChecklistCompletedAt(null);
}

/* ─── Web push availability ─────────────────────────────────────────────── */

/**
 * Web push (Notification + serviceWorker) is a browser-only capability with no
 * React Native analog, and native push (FCM/APNs) is not wired up here, so this
 * always reports `false` on native. Kept as an exported function for parity
 * with the web surface.
 */
export function isWebPushAvailable(): boolean {
  return false;
}

function isWebPushGranted(): boolean {
  // Native cannot grant web push; see `isWebPushAvailable`.
  return false;
}

/* ─── Task definitions ──────────────────────────────────────────────────── */

/**
 * Native-safe icon glyphs that replace the web `lucide-react` components.
 * The web `ChecklistTask.icon` was a `LucideIcon` React component; React
 * Native has no lucide-react and the established parity precedent renders
 * inline lucide icons as decorative `AppText` glyphs. Each glyph is keyed by
 * the original lucide icon name so the web→native mapping stays explicit.
 */
export const CHECKLIST_ICON_GLYPHS = {
  Car: '\u{1F697}',
  Palette: '\u{1F3A8}',
  BellRing: '\u{1F514}',
  Send: '\u{1F4E8}',
  Command: '\u2318',
  BellPlus: '\u{1F6CE}',
  LayoutGrid: '\u25A6',
} as const;

export type ChecklistIconName = keyof typeof CHECKLIST_ICON_GLYPHS;
export type ChecklistIconGlyph =
  (typeof CHECKLIST_ICON_GLYPHS)[ChecklistIconName];

export interface ChecklistTask {
  /** Stable identifier — used for keys and analytics. */
  id: string;
  /** i18n key for the task title. */
  titleKey: string;
  /** English fallback for the title. */
  titleFallback: string;
  /** i18n key for the one-sentence task description. */
  descriptionKey: string;
  descriptionFallback: string;
  /** i18n key for the CTA button label. */
  ctaKey: string;
  ctaFallback: string;
  /** Where the CTA navigates. The sentinel `#open-command-palette` opens
   *  the palette directly via the existing `toggle-command-palette` event
   *  instead of navigating. */
  ctaTo: string;
  /** Whether the task is currently complete (computed by `useChecklistTasks`). */
  complete: boolean;
  /** Native-safe glyph for the task row (web parity for the lucide icon). */
  icon: ChecklistIconGlyph;
}

/** Sentinel `ctaTo` value the widget intercepts to dispatch a palette toggle. */
export const COMMAND_PALETTE_CTA = '#open-command-palette';

/* ─── native translation fallback (native-safe port of react-i18next) ───── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `useTranslation().t`; only the fallback is returned because the
 * checklist deliberately does not translate here (see `void t` below). */
function useNativeTranslation(): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (key, fallback) => fallback ?? key,
    [],
  );
  return {t};
}

/* ─── native theme fallback (native-safe port of useTheme) ──────────────── */

/** Reads the selected `themeId` from native-safe storage, defaulting to the
 * neon-cyan default, and re-reads when the change bus fires. Native theme
 * selection is not wired up yet, so this stays at the default until a native
 * theme store writes `teslasync-theme`. */
function useNativeTheme(): {themeId: string} {
  const [themeId, setThemeId] = useState<string>(
    () => safeRead(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID,
  );
  useEffect(() => {
    const reread = () =>
      setThemeId(safeRead(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID);
    return subscribeChecklistChange(reread);
  }, []);
  return {themeId};
}

/* ─── storage subscription helper ───────────────────────────────────────── */

/**
 * Subscribes the caller to changes in checklist-related storage flags
 * (same-surface via the in-process change bus) and to app-foreground events
 * (native analog of window `focus`). Returns a monotonic counter the caller
 * can include in dependency arrays to force a re-read. Polling is intentional
 * — the flags update infrequently and a 5s tick keeps the widget honest if a
 * sibling component writes a flag without going through the change bus.
 *
 * The web cross-tab `storage` event has no native analog (single surface) and
 * is intentionally dropped.
 */
export function useChecklistFlagVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion(v => v + 1);

    const unsubscribe = subscribeChecklistChange(bump);
    const appStateSub = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') {
          bump();
        }
      },
    );
    const interval = setInterval(bump, 5000);
    return () => {
      unsubscribe();
      appStateSub.remove();
      clearInterval(interval);
    };
  }, []);

  return version;
}

export interface ChecklistState {
  tasks: ChecklistTask[];
  visibleTasks: ChecklistTask[];
  completeCount: number;
  totalCount: number;
  allComplete: boolean;
  /** Whether the user has explicitly dismissed the checklist. */
  dismissed: boolean;
  /** Epoch ms the checklist first reached 100 % complete (or `null`). */
  completedAt: number | null;
  dismiss: () => void;
  restart: () => void;
}

/**
 * Returns the live state of the onboarding checklist. Callers should treat
 * this as a single hook with stable dependencies — every nested data hook is
 * called unconditionally on every render so the rules of hooks are honoured
 * even as tasks become complete or hidden.
 */
export function useChecklistTasks(): ChecklistState {
  const {t} = useNativeTranslation();
  const flagVersion = useChecklistFlagVersion();

  const {data: vehicles} = useVehicles();
  const {data: alertRules} = useAlertRules();
  const {data: channels} = useNotificationChannels();
  const {themeId} = useNativeTheme();

  // Refresh derived booleans whenever the storage version bumps. The `void
  // flagVersion` reads keep the re-read intent explicit: these helpers read
  // mutable in-memory storage, so the version counter is the real trigger.
  const cpDiscovered = useMemo(() => {
    void flagVersion;
    return isCommandPaletteDiscovered();
  }, [flagVersion]);
  const dismissed = useMemo(() => {
    void flagVersion;
    return isChecklistDismissed();
  }, [flagVersion]);
  const completedAt = useMemo(() => {
    void flagVersion;
    return getChecklistCompletedAt();
  }, [flagVersion]);
  const pushGranted = useMemo(() => {
    void flagVersion;
    return isWebPushGranted();
  }, [flagVersion]);
  const customizeDashboard = useMemo(() => {
    void flagVersion;
    return isCustomizeDashboardCompleted();
  }, [flagVersion]);

  const tasks = useMemo<ChecklistTask[]>(() => {
    return [
      {
        id: 'connect-vehicle',
        titleKey: 'checklist.tasks.connectVehicle.title',
        titleFallback: 'Connect your Tesla',
        descriptionKey: 'checklist.tasks.connectVehicle.description',
        descriptionFallback: 'Link your Tesla account to start syncing data.',
        ctaKey: 'checklist.tasks.connectVehicle.cta',
        ctaFallback: 'Connect',
        ctaTo: '/tesla-account',
        complete: (vehicles?.length ?? 0) > 0,
        icon: CHECKLIST_ICON_GLYPHS.Car,
      },
      {
        id: 'pick-theme',
        titleKey: 'checklist.tasks.pickTheme.title',
        titleFallback: 'Pick a theme',
        descriptionKey: 'checklist.tasks.pickTheme.description',
        descriptionFallback: 'Choose an accent color that fits your style.',
        ctaKey: 'checklist.tasks.pickTheme.cta',
        ctaFallback: 'Open',
        ctaTo: '/settings#appearance',
        complete: themeId !== DEFAULT_THEME_ID,
        icon: CHECKLIST_ICON_GLYPHS.Palette,
      },
      {
        id: 'first-alert',
        titleKey: 'checklist.tasks.firstAlert.title',
        titleFallback: 'Create your first alert rule',
        descriptionKey: 'checklist.tasks.firstAlert.description',
        descriptionFallback:
          'Get notified when something changes — battery low, charge complete, etc.',
        ctaKey: 'checklist.tasks.firstAlert.cta',
        ctaFallback: 'Create',
        ctaTo: '/notifications/alerts',
        complete: (alertRules?.length ?? 0) > 0,
        icon: CHECKLIST_ICON_GLYPHS.BellRing,
      },
      {
        id: 'notification-channel',
        titleKey: 'checklist.tasks.notify.title',
        titleFallback: 'Add a notification channel',
        descriptionKey: 'checklist.tasks.notify.description',
        descriptionFallback:
          'Without a channel (Discord, ntfy, email, …) your alerts go to /dev/null.',
        ctaKey: 'checklist.tasks.notify.cta',
        ctaFallback: 'Configure',
        ctaTo: '/notifications/channels',
        complete: (channels?.length ?? 0) > 0,
        icon: CHECKLIST_ICON_GLYPHS.Send,
      },
      {
        id: 'try-command-palette',
        titleKey: 'checklist.tasks.commandPalette.title',
        titleFallback: 'Try the command palette',
        descriptionKey: 'checklist.tasks.commandPalette.description',
        descriptionFallback: 'Press Ctrl+K (or ⌘K) to jump anywhere instantly.',
        ctaKey: 'checklist.tasks.commandPalette.cta',
        ctaFallback: 'Open',
        ctaTo: COMMAND_PALETTE_CTA,
        complete: cpDiscovered,
        icon: CHECKLIST_ICON_GLYPHS.Command,
      },
      {
        id: 'enable-push',
        titleKey: 'checklist.tasks.enablePush.title',
        titleFallback: 'Enable web push notifications',
        descriptionKey: 'checklist.tasks.enablePush.description',
        descriptionFallback:
          'Get alerts in your browser even when TeslaSync is closed.',
        ctaKey: 'checklist.tasks.enablePush.cta',
        ctaFallback: 'Enable',
        ctaTo: '/notifications/browser',
        complete: pushGranted,
        icon: CHECKLIST_ICON_GLYPHS.BellPlus,
      },
      {
        // Surface dashboard widget customization.
        // Completes when the user adds their first widget through the
        // catalogue dialog (which calls `markCustomizeDashboardCompleted`).
        // CTA links to the dashboard so the user can immediately spot the
        // floating + button.
        id: 'customize-dashboard',
        titleKey: 'checklist.tasks.customizeDashboard.title',
        titleFallback: 'Customize your dashboard',
        descriptionKey: 'checklist.tasks.customizeDashboard.description',
        descriptionFallback: 'Add widgets that match how you use TeslaSync.',
        ctaKey: 'checklist.tasks.customizeDashboard.cta',
        ctaFallback: 'Open',
        ctaTo: '/dashboard',
        complete: customizeDashboard,
        icon: CHECKLIST_ICON_GLYPHS.LayoutGrid,
      },
    ];
  }, [
    vehicles,
    alertRules,
    channels,
    themeId,
    cpDiscovered,
    pushGranted,
    customizeDashboard,
  ]);

  // Currently every task is always shown — `show()` predicates would gate
  // here. We keep the split so the widget can iterate `visibleTasks` and the
  // header counts visible tasks only.
  const visibleTasks = tasks;
  const totalCount = visibleTasks.length;
  const completeCount = visibleTasks.reduce(
    (n, task) => (task.complete ? n + 1 : n),
    0,
  );
  const allComplete = totalCount > 0 && completeCount === totalCount;

  // Stamp `completedAt` the first render after we hit 100 %.
  useEffect(() => {
    if (allComplete && completedAt == null) {
      setChecklistCompletedAt(Date.now());
    }
    if (!allComplete && completedAt != null) {
      // User completed something then un-completed it (e.g. revoked push) —
      // clear the celebration timestamp so completing again will re-celebrate.
      setChecklistCompletedAt(null);
    }
  }, [allComplete, completedAt]);

  const dismiss = useCallback(() => setChecklistDismissed(true), []);
  const restart = useCallback(() => restartChecklist(), []);

  // Deliberately accept `t` even though we don't translate here — pages and
  // the widget run translation themselves so that updates to the i18n
  // resource are picked up without busting `useChecklistTasks` consumers.
  void t;

  return {
    tasks,
    visibleTasks,
    completeCount,
    totalCount,
    allComplete,
    dismissed,
    completedAt,
    dismiss,
    restart,
  };
}

/** How long to keep the celebration state visible after 100 % complete. */
export const CELEBRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Should the checklist widget be hidden entirely? Used by the widget when
 * the user has either dismissed the surface or finished it long enough ago
 * that the celebration state has expired.
 */
export function shouldHideChecklist(
  state: Pick<ChecklistState, 'dismissed' | 'allComplete' | 'completedAt'>,
): boolean {
  if (state.dismissed) {
    return true;
  }
  if (state.allComplete && state.completedAt != null) {
    return Date.now() - state.completedAt > CELEBRATION_WINDOW_MS;
  }
  return false;
}

/**
 * Native capability map for this checklist port — documents which web
 * behaviours have a native analog and which are intentionally unavailable.
 */
export const nativeChecklistCapabilities = {
  /** localStorage → in-memory Map; flags reset on a full app reload. */
  flagPersistenceAcrossReload: false,
  /** Cross-tab `storage` events have no native analog (single surface). */
  crossTabSync: false,
  /** Same-surface change notifications via an in-process listener bus. */
  sameProcessChangeBus: true,
  /** window `focus` re-read mapped to `AppState` becoming `active`. */
  appStateFocusRefresh: true,
  /** Web push (Notification + serviceWorker) is browser-only. */
  webPushAvailable: false,
  /** lucide-react icons replaced by decorative glyph strings. */
  iconRendering: 'glyph',
} as const;
