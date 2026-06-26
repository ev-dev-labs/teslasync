// Native parity port of web/src/features/onboarding/TourLauncher.tsx.
//
// `<TourLauncher>` is the modal that lists every onboarding tour in the registry.
// It owns its own visibility: rather than taking an `open` prop, it pops itself
// open in response to a global "open launcher" event (the web dispatches a
// `TOUR_OPEN_LAUNCHER_EVENT` CustomEvent from the sidebar help button, the
// command palette `tour.openLauncher` command, and the Settings tour card) and
// re-renders its "Completed" badges whenever a tour starts/finishes
// (`TOUR_START_EVENT`). Each row shows the tour title + one-line description,
// marks completed tours with a check, highlights the tour matching the current
// route as "Recommended for this page", and exposes a Start/Replay button that
// dispatches `TOUR_START_EVENT` so the app shell can promote it to active state.
// A footer offers "Reset all tours" + "Close".
//
// The web version composes the shared DOM kit (`Modal`, `Button`), the lucide
// Check/PlayCircle/RotateCcw/Sparkles/X SVGs, `react-router-dom`'s
// `useLocation().pathname`, the `cn()` class merge, react-i18next, Tailwind
// utility classes + CSS custom properties, and the `@/lib/tourRegistry` module
// (which itself relies on browser `window` events + `localStorage`). React Native
// has none of those, so this port keeps the same behavioural + visual contract
// with RN primitives:
//   - The shared <Modal open onClose title size="md"> becomes a transparent fade
//     RN <Modal> with a tap-to-dismiss backdrop <Pressable> + a centered dialog
//     card whose header carries the title — the same idiom as the already-ported
//     sibling KeyboardShortcutsModal (another self-opening, globally-triggered
//     modal). The `space-y-3` body + `space-y-2` tour list become a single
//     scrolling <ScrollView> so all eight rows stay reachable on short screens.
//   - The shared <Button variant primary|ghost size="sm"> becomes a reusable
//     <LauncherButton> Pressable (the same idiom as the ShareDriveDialog
//     DialogButton port); the raw "Reset all tours" <button> becomes a subtle
//     text Pressable.
//   - The lucide Check/PlayCircle/Sparkles/RotateCcw/X SVGs become compact text
//     glyphs (the native "no SVG icons" idiom used by SignalConfigModal /
//     MaskedValue): Check -> '\u2713', PlayCircle -> '\u25B6', Sparkles ->
//     '\u2726', RotateCcw -> '\u21BA', X -> '\u2715'.
//   - `cn()` conditional class joins become RN style arrays; Tailwind utilities +
//     CSS custom properties (var(--text-*), var(--glass-border), var(--surface-1),
//     the theme-primary accent, emerald-300) resolve to StyleSheet styles against
//     the native theme tokens.
//
// Native-safe adaptations (documented in the sidecar):
//   - `@/lib/tourRegistry` is browser-only (window CustomEvents + localStorage)
//     and is not separately ported, so — following the WidgetPicker precedent of
//     re-declaring inline the native-safe mirror of an un-portable registry — the
//     registry contract is reproduced inline here: the `TourDefinition` display
//     fields the launcher reads, the eight tours' metadata + `TOUR_ORDER`, the
//     `TOUR_OPEN_LAUNCHER_EVENT`/`TOUR_START_EVENT` identities (verbatim), and the
//     completion/route helpers. `localStorage` becomes a process-scoped in-memory
//     store (no cross-launch persistence — same idiom as the other ports), and
//     the `window.addEventListener`/`dispatchEvent` bus becomes a module-level
//     listener registry (`subscribeTourEvent` + `dispatchTourStart`/
//     `dispatchTourLauncherOpen`) that drives this self-opening modal and is
//     available to future native nav + tests. The web `tourRegistry` steps +
//     `autoStart` predicate are browser-tour-overlay concerns the launcher never
//     reads, so they are intentionally omitted from the native mirror.
//   - `react-router-dom`'s `useLocation().pathname` has no native equivalent, so
//     the active route used by the "Recommended for this page" highlight is
//     supplied by an optional `pageRoute` prop (defaults to ''), matching the
//     sibling KeyboardShortcutsModal port. No native tour-overlay consumes
//     `TOUR_START_EVENT` yet, so starting a tour dispatches the event (re-rendering
//     the badges) but the spotlight walkthrough is the honest "unavailable on
//     native" surface until a native overlay is wired.
//   - react-i18next is not wired in native, so `useTranslation` is replaced by a
//     native key/English-default fallback `t` that also performs `{{var}}`
//     interpolation, so every tour.* key, English fallback, and interpolated
//     {{title}} is preserved verbatim.
//
// No DOM, lucide-react, react-router-dom, Recharts, Leaflet, framer-motion, or
// old web UI components are imported.

import React, {useCallback, useEffect, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

// ---------------------------------------------------------------------------
// Native i18n fallback. react-i18next is not wired in native, so this returns
// the English defaultValue — preserving the web i18n keys + copy verbatim — and
// performs `{{var}}` interpolation so "Replay tour: {{title}}" renders the title.
// ---------------------------------------------------------------------------

type NativeTVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: NativeTVars) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: NativeTVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : `{{${name}}}`,
    );
  }, []);
}

// ---------------------------------------------------------------------------
// Native-safe inline mirror of `@/lib/tourRegistry`. The web registry relies on
// browser `window` CustomEvents + `localStorage`, so only the contract this
// launcher reads is reproduced here (the web tour `steps` + `autoStart` predicate
// are browser-overlay concerns the launcher never touches and are omitted).
// ---------------------------------------------------------------------------

export type TourCompletionStatus = 'completed' | 'skipped';

/** Native-safe subset of the web `TourDefinition` — the fields the launcher reads. */
export interface TourDefinition {
  id: string;
  routeMatch: string | RegExp;
  titleKey: string;
  titleFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  version: number;
}

// Event-name identities preserved verbatim from the web registry so future
// native callers + tests speak the same protocol.
export const TOUR_START_EVENT = 'teslasync:tour:start';
export const TOUR_OPEN_LAUNCHER_EVENT = 'teslasync:tour:openLauncher';

export interface TourStartEventDetail {
  id: string;
}

type TourEventHandler = (detail?: TourStartEventDetail) => void;

// Module-level listener registry — the native replacement for the browser
// `window.addEventListener`/`dispatchEvent` bus.
const tourEventListeners = new Map<string, Set<TourEventHandler>>();

/**
 * Subscribe to a tour event. Native replacement for `window.addEventListener`;
 * used internally by this self-opening modal and exposed so future native nav /
 * tests can drive it. Returns an unsubscribe function.
 */
export function subscribeTourEvent(
  event: string,
  handler: TourEventHandler,
): () => void {
  const set = tourEventListeners.get(event) ?? new Set<TourEventHandler>();
  set.add(handler);
  tourEventListeners.set(event, set);
  return () => {
    set.delete(handler);
  };
}

function emitTourEvent(event: string, detail?: TourStartEventDetail): void {
  const set = tourEventListeners.get(event);
  if (!set) {
    return;
  }
  set.forEach(handler => handler(detail));
}

/** Convenience helper to dispatch the start event. */
export function dispatchTourStart(id: string): void {
  emitTourEvent(TOUR_START_EVENT, {id});
}

/** Convenience helper to dispatch the launcher-open event. */
export function dispatchTourLauncherOpen(): void {
  emitTourEvent(TOUR_OPEN_LAUNCHER_EVENT);
}

// In-memory, process-scoped completion store. React Native has no localStorage,
// so completion flags persist for the life of the JS context (effectively the
// session) but not across cold launches. The web key shape
// (`teslasync:tour:v{version}:{id}` + `teslasync:tour:list-seen`) is preserved.
const STORAGE_PREFIX = 'teslasync:tour';
const LIST_SEEN_KEY = `${STORAGE_PREFIX}:list-seen`;
const tourStorage = new Map<string, string>();

function storageKey(id: string, version: number): string {
  return `${STORAGE_PREFIX}:v${version}:${id}`;
}

/** Returns the stored completion status for a tour at a given version, or null. */
export function getTourStatus(
  id: string,
  version: number,
): TourCompletionStatus | null {
  const raw = tourStorage.get(storageKey(id, version));
  if (raw === 'completed' || raw === 'skipped') {
    return raw;
  }
  return null;
}

/** True when the user has finished or skipped the tour at the current version. */
export function isTourCompleted(id: string, version: number): boolean {
  return getTourStatus(id, version) !== null;
}

/** Marks a tour as completed (user finished all steps). */
export function markTourCompleted(id: string, version: number): void {
  tourStorage.set(storageKey(id, version), 'completed');
}

/** Marks a tour as skipped (user closed mid-way). */
export function markTourSkipped(id: string, version: number): void {
  tourStorage.set(storageKey(id, version), 'skipped');
}

/** Clears the completion flag for a single tour (any version). */
export function resetTour(id: string): void {
  const prefix = `${STORAGE_PREFIX}:`;
  const suffix = `:${id}`;
  for (const key of Array.from(tourStorage.keys())) {
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      tourStorage.delete(key);
    }
  }
}

/** Clears every per-tour completion flag and the list-seen marker. */
export function resetAllTours(): void {
  const prefix = `${STORAGE_PREFIX}:`;
  for (const key of Array.from(tourStorage.keys())) {
    if (key.startsWith(prefix)) {
      tourStorage.delete(key);
    }
  }
  // Legacy single-flag from the pre-Prompt-65 web implementation; removing it
  // keeps parity with the web "Reset all tours" behaviour.
  tourStorage.delete('teslasync-tour-completed');
}

/** Has the launcher been opened at least once? */
export function hasSeenTourList(): boolean {
  return tourStorage.get(LIST_SEEN_KEY) === 'true';
}

/** Records that the launcher has been opened. */
export function markTourListSeen(): void {
  tourStorage.set(LIST_SEEN_KEY, 'true');
}

/** True when the path matches the tour's route hint. */
export function isRecommendedForRoute(
  def: TourDefinition,
  pathname: string,
): boolean {
  if (typeof def.routeMatch === 'string') {
    if (def.routeMatch === '/') {
      return pathname === '/';
    }
    return pathname === def.routeMatch || pathname.startsWith(`${def.routeMatch}/`);
  }
  return def.routeMatch.test(pathname);
}

// The eight tours' display metadata, mirrored verbatim from
// web/src/features/onboarding/tours/*. Steps + autoStart are omitted (see above).
export const TOURS: Record<string, TourDefinition> = {
  main: {
    id: 'main',
    routeMatch: '/',
    titleKey: 'tour.tours.main.title',
    titleFallback: 'Welcome to TeslaSync',
    descriptionKey: 'tour.tours.main.description',
    descriptionFallback: 'A quick tour of the dashboard, sidebar, and live data.',
    version: 2,
  },
  alerts: {
    id: 'alerts',
    routeMatch: /^\/notifications\/(alerts|studio)/,
    titleKey: 'tour.tours.alerts.title',
    titleFallback: 'Alerts & Alert Studio',
    descriptionKey: 'tour.tours.alerts.description',
    descriptionFallback: 'Triage the inbox and craft custom rules with previews.',
    version: 1,
  },
  charging: {
    id: 'charging',
    routeMatch: /^\/(charging|cost-analysis|charging-curve|smart-charge)/,
    titleKey: 'tour.tours.charging.title',
    titleFallback: 'Charging & cost analysis',
    descriptionKey: 'tour.tours.charging.description',
    descriptionFallback: 'Sessions, cost breakdowns, and curve diagnostics.',
    version: 1,
  },
  drives: {
    id: 'drives',
    routeMatch: /^\/drives/,
    titleKey: 'tour.tours.drives.title',
    titleFallback: 'Drives & replay',
    descriptionKey: 'tour.tours.drives.description',
    descriptionFallback: 'Browse drives, replay the route, share moments.',
    version: 1,
  },
  vehicles: {
    id: 'vehicles',
    routeMatch: /^\/vehicles/,
    titleKey: 'tour.tours.vehicles.title',
    titleFallback: 'Vehicles & sharing',
    descriptionKey: 'tour.tours.vehicles.description',
    descriptionFallback: 'Browse fleet, open a vehicle, share access.',
    version: 1,
  },
  automations: {
    id: 'automations',
    routeMatch: /^\/automations/,
    titleKey: 'tour.tours.automations.title',
    titleFallback: 'Automations',
    descriptionKey: 'tour.tours.automations.description',
    descriptionFallback: 'Build triggers, conditions, and actions visually.',
    version: 1,
  },
  settings: {
    id: 'settings',
    routeMatch: /^\/settings/,
    titleKey: 'tour.tours.settings.title',
    titleFallback: 'Settings',
    descriptionKey: 'tour.tours.settings.description',
    descriptionFallback: 'Theme, units, notifications, and tours.',
    version: 1,
  },
  debugger: {
    id: 'debugger',
    routeMatch:
      /^\/(state-debugger|live-monitor|signal-explorer|signal-diff|signal-gaps|mqtt-inspector|signal-log|redis-signals)/,
    titleKey: 'tour.tours.debugger.title',
    titleFallback: 'State machine debugger',
    descriptionKey: 'tour.tours.debugger.description',
    descriptionFallback: 'Timeline, layered sources, freeze/step, deep links.',
    version: 1,
  },
};

/** Iteration order for the launcher list. */
export const TOUR_ORDER: readonly string[] = [
  'main',
  'vehicles',
  'drives',
  'charging',
  'alerts',
  'automations',
  'settings',
  'debugger',
] as const;

/** Lookup helper that returns the definition or null. */
export function getTour(id: string): TourDefinition | null {
  return TOURS[id] ?? null;
}

/** Returns every tour in display order. */
export function listTours(): TourDefinition[] {
  return TOUR_ORDER.map(id => TOURS[id]).filter((d): d is TourDefinition =>
    Boolean(d),
  );
}

// ---------------------------------------------------------------------------
// Resolved palette + lucide-as-glyph affordances. The web uses Tailwind tokens /
// CSS vars; native carries the literal values so the visual intent survives.
// ---------------------------------------------------------------------------

const ACCENT_FILL = 'rgba(53, 213, 255, 0.12)'; // bg-[rgba(--theme-primary-rgb,0.12)]
const ACCENT_FILL_FAINT = 'rgba(53, 213, 255, 0.06)'; // recommended row tint
const EMERALD_300 = '#6ee7b7'; // text-emerald-300
const EMERALD_FILL = 'rgba(110, 231, 183, 0.1)'; // bg-emerald-300/10
const EMERALD_BORDER = 'rgba(110, 231, 183, 0.3)'; // border-emerald-300/30
const WHITE_FILL_04 = 'rgba(255, 255, 255, 0.04)'; // bg-white/[0.04]
const WHITE_FILL_03 = 'rgba(255, 255, 255, 0.03)'; // var(--surface-1) stand-in
const WHITE_BORDER_08 = 'rgba(255, 255, 255, 0.08)'; // var(--border-subtle)

const CHECK_GLYPH = '\u2713'; // ✓ Check (completed)
const PLAY_GLYPH = '\u25B6'; // ▶ PlayCircle (not yet completed)
const SPARKLES_GLYPH = '\u2726'; // ✦ Sparkles (recommended)
const RESET_GLYPH = '\u21BA'; // ↺ RotateCcw (reset all)
const CLOSE_GLYPH = '\u2715'; // ✕ X (close)

// ---------------------------------------------------------------------------
// LauncherButton — native equivalent of the shared <Button variant size="sm">.
// ---------------------------------------------------------------------------

interface LauncherButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  accessibilityLabel?: string;
  leadingGlyph?: string;
  testID?: string;
}

function LauncherButton({
  label,
  onPress,
  variant = 'ghost',
  accessibilityLabel,
  leadingGlyph,
  testID,
}: LauncherButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.btnBase,
        isPrimary ? styles.btnPrimary : styles.btnGhost,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      {leadingGlyph ? (
        <AppText
          style={[
            styles.btnLeadingGlyph,
            isPrimary ? styles.btnPrimaryText : styles.btnGhostText,
          ]}>
          {leadingGlyph}
        </AppText>
      ) : null}
      <AppText
        style={isPrimary ? styles.btnPrimaryText : styles.btnGhostText}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

export function TourLauncher({pageRoute = ''}: {pageRoute?: string}) {
  const t = useNativeTranslationFallback();
  const {height} = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [, setVersionTick] = useState(0);

  // Listen for the global open event so any caller (palette, help button,
  // settings page) can pop the launcher without a ref.
  useEffect(() => {
    return subscribeTourEvent(TOUR_OPEN_LAUNCHER_EVENT, () => {
      setOpen(true);
      markTourListSeen();
    });
  }, []);

  // Force a re-render after a tour starts/finishes so the "Completed" badges
  // pick up the freshly-written completion state when the user re-opens the
  // launcher in the same session.
  useEffect(() => {
    return subscribeTourEvent(TOUR_START_EVENT, () => setVersionTick(n => n + 1));
  }, []);

  const tours = listTours();

  const handleStart = (def: TourDefinition) => {
    setOpen(false);
    // Defer the dispatch one tick so the close re-render settles before the
    // app shell's tour state machine sees the event — same ordering guarantee
    // as the web `window.setTimeout(..., 0)`.
    setTimeout(() => dispatchTourStart(def.id), 0);
  };

  const handleResetAll = () => {
    resetAllTours();
    setVersionTick(n => n + 1);
  };

  const recommendedLabel = t(
    'tour.launcher.recommendedHere',
    'Recommended for this page',
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => setOpen(false)}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={() => setOpen(false)}
          style={styles.backdrop}
        />

        <View style={styles.dialog}>
          <AppText style={styles.title} variant="title" weight="bold">
            {t('tour.launcher.title', 'Take a tour')}
          </AppText>

          <AppText style={styles.subtitle} tone="muted">
            {t(
              'tour.launcher.subtitle',
              'Bite-sized walkthroughs of each area. Replay any tour anytime.',
            )}
          </AppText>

          <ScrollView
            contentContainerStyle={styles.listContent}
            style={[styles.listScroll, {maxHeight: height * 0.55}]}>
            {tours.map(def => {
              const completed = isTourCompleted(def.id, def.version);
              const recommended = isRecommendedForRoute(def, pageRoute);
              const tourTitle = t(def.titleKey, def.titleFallback);
              return (
                <View
                  key={def.id}
                  style={[
                    styles.row,
                    recommended ? styles.rowRecommended : styles.rowIdle,
                  ]}>
                  <View
                    style={[
                      styles.iconBox,
                      completed ? styles.iconBoxCompleted : styles.iconBoxIdle,
                    ]}>
                    <AppText
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      style={[
                        styles.iconGlyph,
                        completed
                          ? styles.iconGlyphCompleted
                          : styles.iconGlyphIdle,
                      ]}>
                      {completed ? CHECK_GLYPH : PLAY_GLYPH}
                    </AppText>
                  </View>

                  <View style={styles.rowContent}>
                    <View style={styles.titleRow}>
                      <AppText style={styles.tourTitle} weight="semibold">
                        {tourTitle}
                      </AppText>
                      {recommended ? (
                        <View style={styles.recommendedBadge}>
                          <AppText style={styles.recommendedBadgeText}>
                            {`${SPARKLES_GLYPH} ${recommendedLabel}`}
                          </AppText>
                        </View>
                      ) : null}
                      {completed ? (
                        <View style={styles.completedBadge}>
                          <AppText style={styles.completedBadgeText}>
                            {t('tour.launcher.completed', 'Completed')}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText style={styles.description} tone="muted">
                      {t(def.descriptionKey, def.descriptionFallback)}
                    </AppText>
                  </View>

                  <LauncherButton
                    accessibilityLabel={
                      completed
                        ? t('tour.launcher.replayAria', 'Replay tour: {{title}}', {
                            title: tourTitle,
                          })
                        : t('tour.launcher.startAria', 'Start tour: {{title}}', {
                            title: tourTitle,
                          })
                    }
                    label={
                      completed
                        ? t('tour.launcher.replay', 'Replay')
                        : t('tour.launcher.start', 'Start')
                    }
                    onPress={() => handleStart(def)}
                    testID={`tour-launch-${def.id}`}
                    variant={recommended ? 'primary' : 'ghost'}
                  />
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={handleResetAll}
              style={({pressed}) => [
                styles.resetButton,
                pressed && styles.pressed,
              ]}
              testID="tour-reset-all">
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.resetGlyph}
                tone="muted">
                {RESET_GLYPH}
              </AppText>
              <AppText style={styles.resetLabel} tone="muted">
                {t('tour.launcher.resetAll', 'Reset all tours')}
              </AppText>
            </Pressable>

            <LauncherButton
              label={t('tour.launcher.close', 'Close')}
              leadingGlyph={CLOSE_GLYPH}
              onPress={() => setOpen(false)}
              testID="tour-close"
              variant="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

TourLauncher.displayName = 'TourLauncher';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  btnBase: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  btnGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  btnGhostText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  btnLeadingGlyph: {
    fontSize: typography.caption,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnPrimaryText: {
    color: colors.background,
    fontSize: typography.caption,
  },
  completedBadge: {
    backgroundColor: EMERALD_FILL,
    borderRadius: 6,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  completedBadgeText: {
    color: EMERALD_300,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  description: {
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxHeight: '88%',
    maxWidth: 520,
    padding: spacing.lg,
    width: '92%',
  },
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    marginTop: 2,
    width: 36,
  },
  iconBoxCompleted: {
    backgroundColor: EMERALD_FILL,
    borderColor: EMERALD_BORDER,
  },
  iconBoxIdle: {
    backgroundColor: WHITE_FILL_04,
    borderColor: WHITE_BORDER_08,
  },
  iconGlyph: {
    fontSize: 16,
  },
  iconGlyphCompleted: {
    color: EMERALD_300,
  },
  iconGlyphIdle: {
    color: colors.textSecondary,
  },
  listContent: {
    gap: spacing.sm,
    paddingRight: spacing.xs,
  },
  listScroll: {
    flexGrow: 0,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  recommendedBadge: {
    backgroundColor: ACCENT_FILL,
    borderRadius: 6,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  recommendedBadgeText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  resetButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  resetGlyph: {
    fontSize: typography.caption,
  },
  resetLabel: {
    fontSize: typography.caption,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowContent: {
    flexShrink: 1,
    minWidth: 0,
    rowGap: spacing.xs,
  },
  rowIdle: {
    backgroundColor: WHITE_FILL_03,
    borderColor: colors.border,
  },
  rowRecommended: {
    backgroundColor: ACCENT_FILL_FAINT,
    borderColor: colors.borderAccent,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  title: {
    color: colors.textPrimary,
  },
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  tourTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
});

export default TourLauncher;
