// Native parity port of web/src/features/dashboard/widgets/AutomationStatusWidget.tsx.
//
// The web widget is a responsive dashboard tile that summarises the user's
// automations. It renders inside the shared <WidgetShell> and switches between a
// CompactView (1x1 - 2x1) and a FullView (2x2+), with a per-row enable <Toggle>
// only shown when the tile is wide (cols >= 3). Data comes from useAutomations()
// and per-row useToggleAutomation(); status/relative-time are derived locally.
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (QuickStatsPage, ExportModal, MiniGridPreview, WidgetSettingsModal) —
// each piece is rebuilt with React Native primitives, AppText, the repo
// SemanticIcon glyphs, the design tokens, and the existing native automation
// hooks. The deps that have no native port yet (WidgetShell, ./types,
// @/components/ui Badge+Toggle, @/components/feedback EmptyState,
// @/components/motion FadeIn, react-i18next) are inlined as self-contained
// native-safe parity within this file.
//
// Line-by-line coverage of the source:
//   L1-9   imports -> react-i18next, lucide-react (Workflow/CheckCircle2/XCircle/
//          Clock/AlertTriangle), web UI Badge+Toggle, feedback EmptyState, motion
//          FadeIn, ./WidgetShell, ./types WidgetProps and @/api/types Automation
//          are replaced by RN primitives, AppText, SemanticIcon glyphs, tokens,
//          the native useAutomations/useToggleAutomation + Automation type, and
//          inlined parity for WidgetShell/Badge/Toggle/EmptyState/FadeIn/t.
//   L11-21 formatRelativeTime(dateStr, t) -> ported verbatim (Date.now() math,
//          'Just now' / '{m}m ago' / '{h}h ago' / '{d}d ago' with the same i18n
//          keys and the '—' null fallback). Native Date is identical to web's.
//   L23-32 getStatusBadge(a, t) -> ported verbatim: auto_disabled -> danger
//          'Auto-disabled', !enabled -> neutral 'Disabled', consecutive_failures
//          > 0 -> warning 'Failing', last_success_at -> success 'OK', else neutral
//          'Idle'. Same i18n keys; BadgeVariant union preserved.
//   L34-59 CompactView -> centered column: cyan Workflow glyph, `{enabled}/{total}`
//          bold count, muted 'Active' label, and a warning dot-Badge `{failing}
//          Failing` when failing > 0. Same enabled/failing filters.
//   L61-110 AutomationRow -> per-row useToggleAutomation() (unconditional, same
//          call order), status Badge, name (truncated -> numberOfLines={1}), a
//          clock-glyph last-run line and a ⏰ next-fire line (both via
//          formatRelativeTime), and the enable Toggle (RN <Switch>) shown only
//          when showToggle, wired to toggle.mutate({id, enabled: checked}) with
//          the same `${Toggle} ${name}` accessibility label.
//   L112-167 FullView -> summary stats row (green check `{enabled} Active`, amber
//          triangle `{failing} Failing` when failing > 0, red x
//          `{count} Auto-disabled` when any auto_disabled) above the scrollable
//          AutomationRow list (isWide forwarded as showToggle). last:border-b-0 is
//          reproduced via an isLast prop.
//   L169-210 AutomationStatusWidget(default export) -> useAutomations() with the
//          same destructure (data/isLoading/error/isFetching/isStale/isError/
//          dataUpdatedAt/refetch), items = data ?? [], isCompact = cols<=1 ||
//          rows<=1, isWide = cols>=3. WidgetShell receives the same conditional
//          title/icon (hidden when isCompact && cols<=1), loading, error
//          (String(error)), and the freshness props (updatedAt/isFetching/
//          isStale/isError/onRefresh=refetch). Body: items.length>0 ? FadeIn ->
//          Compact/Full : EmptyState(workflow glyph, noAutomations message).
//
// No DOM, no react-i18next, no lucide-react, no Recharts/Leaflet, no
// framer-motion, and no web UI components are imported.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import {
  useAutomations,
  useToggleAutomation,
  type Automation,
} from '../../../api/hooks/useAutomations';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` type exactly (no interpolation is
// used by this widget).
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the port stays self-contained.
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

// Repo-canonical native stand-ins for the lucide glyphs, resolved once. The
// per-icon colour intent (Workflow cyan, CheckCircle2 green, AlertTriangle amber,
// XCircle red, Clock muted) is applied at the call sites via glyphToneStyles.
const WORKFLOW_GLYPH = getSemanticIconDefinition('workflow').glyph;
const CHECK_GLYPH = getSemanticIconDefinition('success').glyph;
const XCIRCLE_GLYPH = getSemanticIconDefinition('error').glyph;
const CLOCK_GLYPH = getSemanticIconDefinition('clock').glyph;
const ALERT_GLYPH = getSemanticIconDefinition('warning').glyph;

type GlyphTone = 'cyan' | 'green' | 'amber' | 'red' | 'muted' | 'secondary';

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
    <AppText
      style={[styles.glyph, glyphToneStyles[tone], style]}
      weight="bold">
      {glyph}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Pure logic (ported verbatim)                                       */
/* ------------------------------------------------------------------ */

function formatRelativeTime(
  dateStr: string | null,
  t: NativeTFunction,
): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

type BadgeVariant = 'success' | 'danger' | 'warning' | 'neutral';

function getStatusBadge(
  a: Automation,
  t: NativeTFunction,
): { variant: BadgeVariant; label: string } {
  if (a.auto_disabled)
    return { variant: 'danger', label: t('widget.autoDisabled', 'Auto-disabled') };
  if (!a.enabled) return { variant: 'neutral', label: t('widget.disabled', 'Disabled') };
  if (a.consecutive_failures > 0)
    return { variant: 'warning', label: t('widget.failing', 'Failing') };
  if (a.last_success_at) return { variant: 'success', label: t('widget.ok', 'OK') };
  return { variant: 'neutral', label: t('widget.idle', 'Idle') };
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui <Badge>                                    */
/* ------------------------------------------------------------------ */

// web Badge (size="sm", optional dot). The dot is `bg-current` (text colour);
// the dark-mode variant palette maps to the matching token surface/border/text.
function Badge({
  variant,
  dot,
  children,
}: {
  variant: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeContainerStyles[variant]]}>
      {dot ? <View style={[styles.badgeDot, badgeDotStyles[variant]]} /> : null}
      <AppText
        style={[styles.badgeText, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui <Toggle>                                   */
/* ------------------------------------------------------------------ */

// web Toggle (role="switch") -> the core RN <Switch> (value/onValueChange). The
// web `size="sm"` has no core-Switch analog; it is approximated with a small
// scale transform so the control reads as the compact variant.
function Toggle({
  checked,
  onChange,
  accessibilityLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  accessibilityLabel?: string;
}) {
  return (
    <Switch
      accessibilityLabel={accessibilityLabel}
      ios_backgroundColor={colors.surfaceRaised}
      onValueChange={onChange}
      style={styles.switchSm}
      thumbColor={checked ? colors.accent : colors.textMuted}
      trackColor={{ false: colors.surfaceRaised, true: colors.accentSoft }}
      value={checked}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/motion <FadeIn>                               */
/* ------------------------------------------------------------------ */

// framer-motion is not available on native; the wrapper renders its children
// directly (matching the sibling native page/component ports).
function FadeIn({ children }: { children: ReactNode }) {
  return <View>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, message, className="py-4"): a centred icon glyph above a
// muted message line.
function EmptyState({ glyph, message }: { glyph: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Glyph glyph={glyph} style={styles.emptyGlyph} tone="muted" />
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>). A pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption. Consumes every freshness
// prop so the refresh-on-press behaviour is preserved.
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatRelativeTime(new Date(updatedAt).toISOString(), t)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse-on-data-change effect (web `justUpdated`): ported verbatim; the
  // transient flag drives a subtle border highlight in place of the web box
  // shadow.
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellState}>
        <AppText tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Compact: 1x1 - 2x1                                                 */
/* ------------------------------------------------------------------ */

function CompactView({
  automations,
  t,
}: {
  automations: Automation[];
  t: NativeTFunction;
}) {
  const enabled = automations.filter(a => a.enabled).length;
  const failing = automations.filter(
    a => a.consecutive_failures > 0 && a.enabled,
  ).length;

  return (
    <View style={styles.compactRoot}>
      <Glyph glyph={WORKFLOW_GLYPH} style={styles.compactIcon} tone="cyan" />
      <AppText style={styles.compactCount} weight="bold">
        {enabled}/{automations.length}
      </AppText>
      <AppText style={styles.compactLabel} tone="muted">
        {t('widget.active', 'Active')}
      </AppText>
      {failing > 0 ? (
        <Badge dot variant="warning">
          {failing} {t('widget.failing', 'Failing')}
        </Badge>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Row for full view                                                  */
/* ------------------------------------------------------------------ */

function AutomationRow({
  automation,
  t,
  showToggle,
  isLast,
}: {
  automation: Automation;
  t: NativeTFunction;
  showToggle: boolean;
  isLast: boolean;
}) {
  const toggle = useToggleAutomation();
  const status = getStatusBadge(automation, t);
  const lastRun = automation.last_triggered_at;

  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <View style={styles.rowMain}>
        <View style={styles.rowNameLine}>
          <AppText numberOfLines={1} style={styles.rowName} weight="semibold">
            {automation.name}
          </AppText>
          <Badge variant={status.variant}>{status.label}</Badge>
        </View>
        <View style={styles.rowMeta}>
          {lastRun ? (
            <View style={styles.rowMetaItem}>
              <Glyph glyph={CLOCK_GLYPH} style={styles.rowMetaGlyph} tone="muted" />
              <AppText style={styles.rowMetaText} tone="muted">
                {formatRelativeTime(lastRun, t)}
              </AppText>
            </View>
          ) : null}
          {automation.next_fire_time ? (
            <View style={styles.rowMetaItem}>
              <AppText style={styles.rowMetaText} tone="muted">
                ⏰ {formatRelativeTime(automation.next_fire_time, t)}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
      {showToggle ? (
        <Toggle
          accessibilityLabel={`${t('widget.toggle', 'Toggle')} ${automation.name}`}
          checked={automation.enabled}
          onChange={checked =>
            toggle.mutate({ id: automation.id, enabled: checked })
          }
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Full: 2x2+                                                         */
/* ------------------------------------------------------------------ */

function FullView({
  automations,
  t,
  isWide,
}: {
  automations: Automation[];
  t: NativeTFunction;
  isWide: boolean;
}) {
  const enabled = automations.filter(a => a.enabled).length;
  const failing = automations.filter(
    a => a.consecutive_failures > 0 && a.enabled,
  ).length;
  const autoDisabled = automations.filter(a => a.auto_disabled).length;

  return (
    <View style={styles.fullRoot}>
      {/* Summary stats */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Glyph glyph={CHECK_GLYPH} style={styles.summaryGlyph} tone="green" />
          <AppText style={styles.summaryText} tone="secondary">
            {enabled} {t('widget.active', 'Active')}
          </AppText>
        </View>
        {failing > 0 ? (
          <View style={styles.summaryItem}>
            <Glyph glyph={ALERT_GLYPH} style={styles.summaryGlyph} tone="amber" />
            <AppText style={[styles.summaryText, styles.summaryTextAmber]}>
              {failing} {t('widget.failing', 'Failing')}
            </AppText>
          </View>
        ) : null}
        {autoDisabled > 0 ? (
          <View style={styles.summaryItem}>
            <Glyph glyph={XCIRCLE_GLYPH} style={styles.summaryGlyph} tone="red" />
            <AppText style={[styles.summaryText, styles.summaryTextRed]}>
              {autoDisabled} {t('widget.autoDisabled', 'Auto-disabled')}
            </AppText>
          </View>
        ) : null}
      </View>

      {/* Automation list */}
      <View style={styles.list}>
        {automations.map((a, i) => (
          <AutomationRow
            automation={a}
            isLast={i === automations.length - 1}
            key={a.id}
            showToggle={isWide}
            t={t}
          />
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function AutomationStatusWidget({ size }: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {
    data: automations,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useAutomations();

  const items = automations ?? [];
  const isCompact = size.cols <= 1 || size.rows <= 1;
  const isWide = size.cols >= 3;

  const showHeader = !(isCompact && size.cols <= 1);

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        showHeader ? (
          <Glyph glyph={WORKFLOW_GLYPH} style={styles.headerIcon} tone="cyan" />
        ) : undefined
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={
        showHeader ? t('widget.automationStatus', 'Automation Status') : undefined
      }
      updatedAt={dataUpdatedAt}>
      {items.length > 0 ? (
        <FadeIn>
          {isCompact ? (
            <CompactView automations={items} t={t} />
          ) : (
            <FullView automations={items} isWide={isWide} t={t} />
          )}
        </FadeIn>
      ) : (
        <EmptyState
          glyph={WORKFLOW_GLYPH}
          message={t('widget.noAutomations', 'No automations configured')}
        />
      )}
    </WidgetShell>
  );
}

AutomationStatusWidget.displayName = 'AutomationStatusWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const AUTOMATION_STATUS_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Glyph base ---
  glyph: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  shellState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
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
  shellFreshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // --- DataFreshness ---
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Compact view ---
  compactRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  compactIcon: {
    fontSize: 14,
    lineHeight: 18,
  },
  compactCount: {
    fontSize: 18,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Badge ---
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- Toggle ---
  switchSm: {
    transform: [{ scale: 0.85 }],
  },

  // --- Row ---
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  rowName: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  rowMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rowMetaGlyph: {
    fontSize: 9,
    lineHeight: 12,
  },
  rowMetaText: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Full view ---
  fullRoot: {
    flex: 1,
    gap: spacing.sm,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 16,
  },
  summaryTextAmber: {
    color: colors.warning,
  },
  summaryTextRed: {
    color: colors.danger,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },

  // --- Empty state ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- Header icon ---
  headerIcon: {
    fontSize: 10,
    lineHeight: 14,
  },
});

const glyphToneStyles = StyleSheet.create<Record<GlyphTone, TextStyle>>({
  cyan: {
    color: colors.accent,
  },
  green: {
    color: colors.success,
  },
  amber: {
    color: colors.warning,
  },
  red: {
    color: colors.danger,
  },
  muted: {
    color: colors.textMuted,
  },
  secondary: {
    color: colors.textSecondary,
  },
});

const badgeContainerStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
  warning: {
    color: colors.warning,
  },
  neutral: {
    color: colors.textSecondary,
  },
});

const badgeDotStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.success,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  warning: {
    backgroundColor: colors.warning,
  },
  neutral: {
    backgroundColor: colors.textSecondary,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
