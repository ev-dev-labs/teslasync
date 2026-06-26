// Native parity port of
// web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx.
//
// The web widget is the first-run setup checklist tile. It renders inside the
// shared <WidgetShell> and has three visibility modes (driven by
// shouldHideChecklist + useChecklistTasks from @/features/onboarding/checklist):
//   1. full checklist while at least one task is incomplete,
//   2. a celebratory "all set" footer once 100% complete (for 24h),
//   3. a small "hidden/dismissed" <EmptyState> with a Restart affordance once
//      dismissed or after the celebration window elapses.
// Each task auto-completes when its underlying client state flips.
//
// None of the web imports are native-safe (react-router-dom useNavigate,
// react-i18next, lucide-react, @/components/feedback EmptyState, @/components/ui
// Button, @/lib/cn, ./WidgetShell, ./types, and the entire
// @/features/onboarding/checklist module which leans on localStorage, window
// events, the Notification/serviceWorker web-push APIs, and useTheme). Mirroring
// the sibling native widget ports (AutomationStatusWidget, CostBreakdownWidget,
// MediaNowPlayingWidget), every un-ported piece is rebuilt with React Native
// primitives, AppText, the repo SemanticIcon glyphs and the design tokens. The
// checklist module has no native port yet, so its consumed surface
// (useChecklistTasks, shouldHideChecklist, COMMAND_PALETTE_CTA + the flag
// helpers it depends on) is inlined here as a native-safe parity: an in-memory
// flag store + subscriber bus replaces localStorage + window events; web push
// availability/permission collapse to "unavailable" (always false) on native;
// the real native useVehicles/useAlertRules/useNotificationChannels hooks are
// preserved so API paths (/vehicles, /alerts/rules, /notifications) and the
// fixed hook-call order are retained; navigation defaults to a host-overridable
// no-op sink and the command-palette CTA toggles the real native palette bus
// (emitToggleCommandPalette).
//
// Line-by-line coverage of the 239-line source:
//   L1-25   imports -> RN primitives, AppText, SemanticIcon glyphs, tokens, the
//           native useVehicles/useAlertRules/useNotificationChannels hooks,
//           emitToggleCommandPalette, plus inlined native-safe parity for
//           EmptyState/Button/cn/WidgetShell/WidgetProps and the checklist
//           module (useChecklistTasks/shouldHideChecklist/COMMAND_PALETTE_CTA).
//   L27-42  component JSDoc -> condensed into this header; the three visibility
//           modes are preserved exactly.
//   L43-60  default export, useTranslation -> useNativeTranslationFallback,
//           useNavigate -> native no-op nav sink, useChecklistTasks destructure
//           (visibleTasks/completeCount/totalCount/allComplete/dismissed/
//           completedAt/dismiss/restart) and progressPct math ported verbatim.
//   L62-73  handleCta -> COMMAND_PALETTE_CTA dispatches the native palette bus
//           (web dispatched a 'toggle-command-palette' window Event); every
//           other ctaTo calls the native navigation sink (web: navigate(ctaTo)).
//   L75-76  title 'checklist.title'/'Get started'; Rocket icon -> cyan/accent
//           Glyph (text-cyan-300).
//   L78-101 hidden state -> WidgetShell + EmptyState(sparkles glyph, allComplete
//           ? completeMessage : dismissedTitle, dismissedMessage, restart
//           action). Every key/fallback preserved.
//   L103-114 headerActions dismiss button (X glyph, muted, aria-label/title
//           'checklist.dismiss'/'Dismiss') -> Pressable.
//   L116-151 progress header -> '{{done}}/{{total}} complete' (interpolated),
//           '{{progressPct}}%', and the role=progressbar track/fill. The
//           Tailwind gradient (emerald->cyan when allComplete else cyan->indigo)
//           collapses to a solid success/accent fill (no RN gradient primitive).
//   L153-159 totalCount===0 EmptyState(check glyph, 'checklist.empty').
//   L161-214 task list <ul> -> rows with completion indicator (CheckCircle2
//           emerald / Circle muted), the hidden sm:inline-flex icon badge (no RN
//           breakpoint -> always shown), truncated title (line-through+secondary
//           when complete, else primary) + truncated description, and the ghost
//           CTA Button (label + ArrowRight, cyan) shown only when !complete.
//           data-testid -> testID; data-complete -> accessibilityState.selected.
//   L216-235 completion footer (allComplete) -> emerald panel: Sparkles +
//           completeMessage + ghost Dismiss Button (RotateCcw leading icon).
//   L236-239 close tags / default export.
//
// No DOM, react-router-dom, react-i18next, lucide-react, Recharts, Leaflet,
// framer-motion, or web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type TextStyle,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors } from '../../../../theme/tokens';
import { emitToggleCommandPalette } from '../../../components/ui/CommandPalette';
import { useVehicles } from '../../../api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationChannels,
} from '../../../api/hooks/useNotifications';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation(). Native parity has no i18n
// runtime wired, so this returns the English fallback for every (key, fallback)
// pair and reproduces the `{{done}}/{{total}}` interpolation the progress label
// uses. Every i18n key is preserved at the call sites.
type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : `{{${name}}}`,
    );
  }, []);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ------------------------------------------------------------------ */
/*  lucide -> repo SemanticIcon glyph stand-ins                        */
/* ------------------------------------------------------------------ */

// Resolved once. Where a clean semantic match exists we reuse the repo glyph;
// Rocket and Circle have no semantic equivalent so they get local short codes in
// the same 1-2 char style. Per-icon colour intent is applied at the call sites.
const ROCKET_GLYPH = 'RK'; // lucide Rocket — no semantic match
const CIRCLE_GLYPH = 'O'; // lucide Circle — no semantic match
const CHECK_GLYPH = getSemanticIconDefinition('success').glyph; // CheckCircle2
const ARROW_RIGHT_GLYPH = getSemanticIconDefinition('forward').glyph; // ArrowRight
const SPARKLES_GLYPH = getSemanticIconDefinition('sparkles').glyph; // Sparkles
const X_GLYPH = getSemanticIconDefinition('close').glyph; // X
const ROTATE_GLYPH = getSemanticIconDefinition('undo').glyph; // RotateCcw
const CAR_GLYPH = getSemanticIconDefinition('vehicle').glyph; // Car
const PALETTE_GLYPH = getSemanticIconDefinition('palette').glyph; // Palette
const BELL_RING_GLYPH = getSemanticIconDefinition('notifications').glyph; // BellRing
const SEND_GLYPH = getSemanticIconDefinition('send').glyph; // Send
const COMMAND_GLYPH = getSemanticIconDefinition('keyboard').glyph; // Command
const BELL_PLUS_GLYPH = getSemanticIconDefinition('notificationsAdd').glyph; // BellPlus
const LAYOUT_GRID_GLYPH = getSemanticIconDefinition('layoutGrid').glyph; // LayoutGrid

type GlyphTone = 'accent' | 'emerald' | 'muted' | 'secondary';

function Glyph({
  glyph,
  tone,
  style,
}: {
  glyph: string;
  tone: GlyphTone;
  style?: TextStyle | TextStyle[];
}) {
  return (
    <AppText style={[styles.glyph, glyphToneStyles[tone], style]} weight="bold">
      {glyph}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/features/onboarding/checklist (native-safe parity)       */
/* ------------------------------------------------------------------ */

// localStorage keys — kept byte-for-byte from the web module so a future native
// persistence layer can adopt them.
const CP_DISCOVERED_KEY = 'teslasync:cp-discovered';
const CHECKLIST_DISMISSED_KEY = 'teslasync:checklist:dismissed';
const CHECKLIST_COMPLETED_AT_KEY = 'teslasync:checklist:completed-at';
const CUSTOMIZE_DASHBOARD_KEY = 'teslasync:checklist:customizeDashboard';

// Default theme id — selecting any other theme counts as "picked a theme".
const DEFAULT_THEME_ID = 'neon-cyan';

// Sentinel ctaTo the widget intercepts to toggle the command palette.
const COMMAND_PALETTE_CTA = '#open-command-palette';

// How long to keep the celebration state visible after 100% complete.
const CELEBRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// In-memory flag store + subscriber bus. Web persisted these flags to
// localStorage and broadcast changes via the `storage`/CHECKLIST_CHANGED_EVENT/
// `focus` window events plus a 5s poll. Native has none of those, so the store
// lives in module memory and a Set-based bus replaces every cross-tab/focus/poll
// trigger (cleanup-safe, no open timers).
const flagStore = new Map<string, string>();
const flagSubscribers = new Set<() => void>();

function notifyFlagSubscribers(): void {
  for (const handler of flagSubscribers) {
    try {
      handler();
    } catch {
      // swallow — a misbehaving subscriber must not break the widget.
    }
  }
}

function safeRead(key: string): string | null {
  return flagStore.has(key) ? flagStore.get(key) ?? null : null;
}

function safeWrite(key: string, value: string | null): void {
  if (value === null) {
    flagStore.delete(key);
  } else {
    flagStore.set(key, value);
  }
  notifyFlagSubscribers();
}

// Command-palette + customize-dashboard discovery instrumentation. Exported so a
// native host (the palette open effect / the dashboard widget catalogue) can
// flip the corresponding tasks, mirroring the web module's exported markers.
export function markCommandPaletteDiscovered(): void {
  if (safeRead(CP_DISCOVERED_KEY)) {
    return;
  }
  safeWrite(CP_DISCOVERED_KEY, '1');
}

export function markCustomizeDashboardCompleted(): void {
  if (safeRead(CUSTOMIZE_DASHBOARD_KEY)) {
    return;
  }
  safeWrite(CUSTOMIZE_DASHBOARD_KEY, '1');
}

function isCommandPaletteDiscovered(): boolean {
  return safeRead(CP_DISCOVERED_KEY) === '1';
}

function isCustomizeDashboardCompleted(): boolean {
  return safeRead(CUSTOMIZE_DASHBOARD_KEY) === '1';
}

function isChecklistDismissed(): boolean {
  return safeRead(CHECKLIST_DISMISSED_KEY) === '1';
}

function setChecklistDismissed(dismissed: boolean): void {
  safeWrite(CHECKLIST_DISMISSED_KEY, dismissed ? '1' : null);
}

function getChecklistCompletedAt(): number | null {
  const raw = safeRead(CHECKLIST_COMPLETED_AT_KEY);
  if (!raw) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function setChecklistCompletedAt(ms: number | null): void {
  safeWrite(CHECKLIST_COMPLETED_AT_KEY, ms == null ? null : String(ms));
}

function restartChecklist(): void {
  setChecklistDismissed(false);
  setChecklistCompletedAt(null);
}

// Web push availability + permission are browser-only (window.Notification +
// navigator.serviceWorker). Native parity has neither, so the "enable web push"
// task is permanently incomplete (explicit unavailable state).
function isWebPushGranted(): boolean {
  return false;
}

// Native parity has no ThemeProvider mounted (the web read themeId from
// useTheme()). Resolve to the default so "pick a theme" mirrors a fresh install
// (incomplete) until a host wires a real theme source.
function resolveActiveThemeId(): string {
  return DEFAULT_THEME_ID;
}

// Native navigation sink. The web used react-router's useNavigate(); the native
// parity tree mounts no router here, so route CTAs default to a no-op a host can
// override (the command-palette CTA still toggles the real native palette).
type ChecklistNavigate = (to: string) => void;
let checklistNavigate: ChecklistNavigate = () => {};

export function setOnboardingChecklistNavigator(fn: ChecklistNavigate): void {
  checklistNavigate = fn;
}

interface ChecklistTask {
  id: string;
  titleKey: string;
  titleFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  ctaKey: string;
  ctaFallback: string;
  ctaTo: string;
  complete: boolean;
  glyph: string;
}

interface ChecklistState {
  tasks: ChecklistTask[];
  visibleTasks: ChecklistTask[];
  completeCount: number;
  totalCount: number;
  allComplete: boolean;
  dismissed: boolean;
  completedAt: number | null;
  dismiss: () => void;
  restart: () => void;
}

// Subscribes to the in-memory flag bus and returns a monotonic counter the
// caller can fold into dependency arrays to force a re-read (web parity of
// useChecklistFlagVersion, minus the browser storage/focus/poll triggers).
function useChecklistFlagVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    flagSubscribers.add(bump);
    return () => {
      flagSubscribers.delete(bump);
    };
  }, []);

  return version;
}

function useChecklistTasks(): ChecklistState {
  const flagVersion = useChecklistFlagVersion();

  // Every data hook is called unconditionally, in the same fixed order as the
  // web module, so the rules of hooks are honoured as tasks complete/hide.
  const { data: vehicles } = useVehicles();
  const { data: alertRules } = useAlertRules();
  const { data: channels } = useNotificationChannels();

  // `flagVersion` is referenced (void) purely as the recompute trigger: it bumps
  // whenever the in-memory flag store changes, re-reading the derived booleans
  // (native-safe parity of the web module's localStorage version counter).
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
        glyph: CAR_GLYPH,
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
        complete: resolveActiveThemeId() !== DEFAULT_THEME_ID,
        glyph: PALETTE_GLYPH,
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
        glyph: BELL_RING_GLYPH,
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
        glyph: SEND_GLYPH,
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
        glyph: COMMAND_GLYPH,
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
        glyph: BELL_PLUS_GLYPH,
      },
      {
        // Completes when the user adds their first widget through the catalogue
        // (markCustomizeDashboardCompleted). CTA links to the dashboard.
        id: 'customize-dashboard',
        titleKey: 'checklist.tasks.customizeDashboard.title',
        titleFallback: 'Customize your dashboard',
        descriptionKey: 'checklist.tasks.customizeDashboard.description',
        descriptionFallback: 'Add widgets that match how you use TeslaSync.',
        ctaKey: 'checklist.tasks.customizeDashboard.cta',
        ctaFallback: 'Open',
        ctaTo: '/dashboard',
        complete: customizeDashboard,
        glyph: LAYOUT_GRID_GLYPH,
      },
    ];
  }, [vehicles, alertRules, channels, cpDiscovered, pushGranted, customizeDashboard]);

  const visibleTasks = tasks;
  const totalCount = visibleTasks.length;
  const completeCount = visibleTasks.reduce(
    (n, task) => (task.complete ? n + 1 : n),
    0,
  );
  const allComplete = totalCount > 0 && completeCount === totalCount;

  // Stamp completedAt the first render after hitting 100%; clear it if a task
  // later un-completes so completing again re-celebrates.
  useEffect(() => {
    if (allComplete && completedAt == null) {
      setChecklistCompletedAt(Date.now());
    }
    if (!allComplete && completedAt != null) {
      setChecklistCompletedAt(null);
    }
  }, [allComplete, completedAt]);

  const dismiss = useCallback(() => setChecklistDismissed(true), []);
  const restart = useCallback(() => restartChecklist(), []);

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

function shouldHideChecklist(
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

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui <Button>                                   */
/* ------------------------------------------------------------------ */

// web Button (variant="ghost"/"secondary", size="sm", optional leading icon).
// The CTA renders label + trailing ArrowRight; the footer Dismiss renders a
// leading RotateCcw; the EmptyState action renders a plain secondary button.
function Button({
  label,
  onPress,
  variant,
  tone,
  leadingGlyph,
  trailingGlyph,
}: {
  label: string;
  onPress: () => void;
  variant: 'ghost' | 'secondary';
  tone: 'accent' | 'secondary';
  leadingGlyph?: string;
  trailingGlyph?: string;
}) {
  const glyphTone: GlyphTone = tone === 'accent' ? 'accent' : 'secondary';
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' ? styles.buttonSecondary : styles.buttonGhost,
        pressed && styles.buttonPressed,
      ]}>
      {leadingGlyph ? (
        <Glyph glyph={leadingGlyph} style={styles.buttonGlyph} tone={glyphTone} />
      ) : null}
      <AppText
        style={[
          styles.buttonText,
          tone === 'accent' ? styles.buttonTextAccent : styles.buttonTextSecondary,
        ]}
        weight="semibold">
        {label}
      </AppText>
      {trailingGlyph ? (
        <Glyph glyph={trailingGlyph} style={styles.buttonGlyph} tone={glyphTone} />
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, title?, message, action?): centred icon glyph (muted),
// optional title, message, and an optional secondary action button.
function EmptyState({
  glyph,
  title,
  message,
  action,
}: {
  glyph: string;
  title?: string;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.emptyState}>
      <Glyph glyph={glyph} style={styles.emptyGlyph} tone="muted" />
      {title ? (
        <AppText style={styles.emptyTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          tone="secondary"
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// This widget only uses WidgetShell's title/icon/actions/children surface (it
// passes no loading/error/freshness/help/pin props), so the inlined parity is
// scoped to exactly that: a header (icon + uppercase muted title + right-aligned
// actions) above the body.
function WidgetShell({
  title,
  icon,
  actions,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {actions ? <View style={styles.shellActions}>{actions}</View> : null}
        </View>
      ) : actions ? (
        <View style={styles.shellActionsOnly}>{actions}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  OnboardingChecklistWidget                                          */
/* ------------------------------------------------------------------ */

export default function OnboardingChecklistWidget(_props: WidgetProps) {
  const t = useNativeTranslationFallback();

  const state = useChecklistTasks();
  const {
    visibleTasks,
    completeCount,
    totalCount,
    allComplete,
    dismissed,
    completedAt,
    dismiss,
    restart,
  } = state;

  const hidden = shouldHideChecklist({ dismissed, allComplete, completedAt });
  const progressPct =
    totalCount === 0 ? 0 : Math.round((completeCount / totalCount) * 100);

  const handleCta = useCallback((ctaTo: string) => {
    if (ctaTo === COMMAND_PALETTE_CTA) {
      emitToggleCommandPalette();
      return;
    }
    checklistNavigate(ctaTo);
  }, []);

  const title = t('checklist.title', 'Get started');
  const icon = <Glyph glyph={ROCKET_GLYPH} style={styles.titleIcon} tone="accent" />;

  // ── Hidden / dismissed state — small footprint with restart affordance ──
  if (hidden) {
    return (
      <WidgetShell icon={icon} title={title}>
        <EmptyState
          action={{
            label: t('checklist.restart', 'Restart checklist'),
            onPress: restart,
          }}
          glyph={SPARKLES_GLYPH}
          message={t(
            'checklist.dismissedMessage',
            'Remove this widget from your dashboard or restart the checklist to see your remaining setup steps.',
          )}
          title={
            allComplete
              ? t('checklist.completeMessage', "You're all set! 🎉")
              : t('checklist.dismissedTitle', 'Setup checklist hidden')
          }
        />
      </WidgetShell>
    );
  }

  // ── Header actions: dismiss button (always visible while widget renders) ──
  const headerActions = (
    <Pressable
      accessibilityLabel={t('checklist.dismiss', 'Dismiss')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={dismiss}
      style={styles.dismissButton}>
      <Glyph glyph={X_GLYPH} style={styles.dismissGlyph} tone="muted" />
    </Pressable>
  );

  return (
    <WidgetShell actions={headerActions} icon={icon} title={title}>
      <View style={styles.body}>
        {/* Progress header */}
        <View style={styles.progressSection}>
          <View style={styles.progressRow}>
            <AppText style={styles.progressLabel} weight="semibold">
              {t('checklist.progress', '{{done}}/{{total}} complete', {
                done: completeCount,
                total: totalCount,
              })}
            </AppText>
            <AppText style={styles.progressPct} tone="muted">
              {progressPct}%
            </AppText>
          </View>
          <View
            accessibilityLabel={t('checklist.progress', '{{done}}/{{total}} complete', {
              done: completeCount,
              total: totalCount,
            })}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: totalCount, now: completeCount }}
            style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                allComplete ? styles.progressFillComplete : styles.progressFillActive,
                { width: `${progressPct}%` as DimensionValue },
              ]}
            />
          </View>
        </View>

        {/* Task list */}
        {totalCount === 0 ? (
          <EmptyState
            glyph={CHECK_GLYPH}
            message={t('checklist.empty', 'No setup steps available right now.')}
          />
        ) : (
          <View style={styles.taskList} testID="onboarding-checklist">
            {visibleTasks.map(task => (
              <View
                accessibilityState={{ selected: task.complete }}
                key={task.id}
                style={[styles.taskRow, task.complete && styles.taskRowComplete]}
                testID={`checklist-task-${task.id}`}>
                <View style={styles.taskIndicator}>
                  <Glyph
                    glyph={task.complete ? CHECK_GLYPH : CIRCLE_GLYPH}
                    style={styles.indicatorGlyph}
                    tone={task.complete ? 'emerald' : 'muted'}
                  />
                </View>
                <View style={styles.taskBadge}>
                  <Glyph glyph={task.glyph} style={styles.taskBadgeGlyph} tone="secondary" />
                </View>
                <View style={styles.taskText}>
                  <AppText
                    numberOfLines={1}
                    style={[
                      styles.taskTitle,
                      task.complete ? styles.taskTitleComplete : styles.taskTitleActive,
                    ]}>
                    {t(task.titleKey, task.titleFallback)}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={styles.taskDesc}
                    tone="secondary">
                    {t(task.descriptionKey, task.descriptionFallback)}
                  </AppText>
                </View>
                {!task.complete ? (
                  <Button
                    label={t(task.ctaKey, task.ctaFallback)}
                    onPress={() => handleCta(task.ctaTo)}
                    tone="accent"
                    trailingGlyph={ARROW_RIGHT_GLYPH}
                    variant="ghost"
                  />
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* Completion footer — celebrates 100% and offers restart */}
        {allComplete ? (
          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              <Glyph glyph={SPARKLES_GLYPH} style={styles.footerGlyph} tone="emerald" />
              <AppText numberOfLines={1} style={styles.footerText} weight="semibold">
                {t('checklist.completeMessage', "You're all set! 🎉")}
              </AppText>
            </View>
            <Button
              label={t('checklist.dismiss', 'Dismiss')}
              leadingGlyph={ROTATE_GLYPH}
              onPress={dismiss}
              tone="secondary"
              variant="ghost"
            />
          </View>
        ) : null}
      </View>
    </WidgetShell>
  );
}

OnboardingChecklistWidget.displayName = 'OnboardingChecklistWidget';

const EMERALD_300 = '#6ee7b7';
const EMERALD_200 = '#a7f3d0';
const WHITE_02 = 'rgba(255, 255, 255, 0.02)';
const WHITE_04 = 'rgba(255, 255, 255, 0.04)';
const WHITE_06 = 'rgba(255, 255, 255, 0.06)';

const styles = StyleSheet.create({
  // --- Glyph base ---
  glyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  shellHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shellActionsOnly: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },

  // --- Title icon ---
  titleIcon: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- Body wrapper (flex flex-col gap-4) ---
  body: {
    flex: 1,
    gap: 16,
  },

  // --- Progress header ---
  progressSection: {
    gap: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  progressPct: {
    fontSize: 12,
    lineHeight: 16,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: WHITE_06,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressFillActive: {
    backgroundColor: colors.accent,
  },
  progressFillComplete: {
    backgroundColor: colors.success,
  },

  // --- Empty state ---
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  emptyTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },

  // --- Task list ---
  taskList: {
    gap: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: WHITE_06,
    backgroundColor: WHITE_02,
    padding: 12,
  },
  taskRowComplete: {
    opacity: 0.6,
  },
  taskIndicator: {
    flexShrink: 0,
  },
  indicatorGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  taskBadge: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WHITE_04,
  },
  taskBadgeGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },
  taskText: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  taskTitleActive: {
    color: colors.textPrimary,
  },
  taskTitleComplete: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  taskDesc: {
    fontSize: 12,
    lineHeight: 16,
  },

  // --- Button (ghost / secondary, sm) ---
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexShrink: 0,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },
  buttonText: {
    fontSize: 12,
    lineHeight: 16,
  },
  buttonTextAccent: {
    color: colors.accent,
  },
  buttonTextSecondary: {
    color: colors.textSecondary,
  },

  // --- Dismiss header button ---
  dismissButton: {
    padding: 6,
    borderRadius: 8,
  },
  dismissGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- Completion footer ---
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
    backgroundColor: 'rgba(110, 231, 183, 0.06)',
    padding: 12,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  footerGlyph: {
    fontSize: 13,
    lineHeight: 16,
    color: EMERALD_300,
  },
  footerText: {
    fontSize: 14,
    lineHeight: 18,
    color: EMERALD_200,
    flexShrink: 1,
  },
});

const glyphToneStyles = StyleSheet.create<Record<GlyphTone, TextStyle>>({
  accent: {
    color: colors.accent,
  },
  emerald: {
    color: EMERALD_300,
  },
  muted: {
    color: colors.textMuted,
  },
  secondary: {
    color: colors.textSecondary,
  },
});
