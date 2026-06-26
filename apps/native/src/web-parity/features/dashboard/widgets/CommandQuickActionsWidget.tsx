// Native parity port of
// web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx.
//
// A dashboard widget that renders a grid of one-tap Tesla vehicle commands
// (lock / unlock / climate on-off / frunk / horn / flash / trunk). The number
// of commands shown adapts to the widget size: the compact (1x1) layout shows
// the first four as a 2x2 icon-only grid, the wide (>=3 col) layout shows all
// eight, and the medium layout shows the first six. Tapping a command fires the
// shared useVehicleCommand mutation against the resolved vehicle id and shows a
// spinner on the active tile while every tile is disabled until it settles. When
// there is no vehicle an EmptyState is shown instead of the grid.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (AutomationHistoryWidget /
// ChargingOptimizerWidget) — every such dependency is reproduced inline with
// React Native primitives + the shared native building blocks and documented in
// the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: when a title is supplied (the
//     non-compact branch) it renders a header (icon + uppercase muted title +
//     freshness chip) over the children; when title-less (the compact branch,
//     which passes title/icon = undefined) it overlays a compact dot-only
//     freshness chip top-right over the children — exactly like the web shell's
//     two branches (web L120-164). This widget never passes `loading`/`error`,
//     so those shell branches are out of scope and omitted.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip WidgetShell renders — is reproduced inline as `WidgetFreshness`:
//     same isError>fetching>stale>fresh precedence, the same dot colour tiers,
//     the "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error"
//     labels, the 30s re-render tick, onRefresh wired to a Pressable
//     (role=button), and the `compact` (dot-only, label hidden) mode the
//     title-less header uses.
//   - @/components/ui Button (variant="ghost") -> local `CommandButton`
//     Pressable reproducing the exact web classes: rounded-lg, bg-white/[0.03],
//     hover:bg-white/[0.08] (pressed), border border-white/[0.06], py-2 px-1,
//     vertical icon-over-label stack with gap-1, h-auto, and the web Button's
//     disabled:opacity-50 + disabled:pointer-events-none behaviour (every tile
//     is disabled while any command is running). aria-label -> accessibilityLabel.
//   - feedback EmptyState -> shared native EmptyState (web's single `message`
//     becomes the native `title`; the web Zap `icon` + `className="py-4"` have no
//     native EmptyState slot and are dropped — the bolt signal is preserved by
//     the header glyph).
//   - lucide-react Lock/Unlock/Thermometer/ThermometerSnowflake/Container/
//     Flashlight/Volume2/Zap have no native icon font; each command icon is
//     reduced to a short 2-char glyph while the meaningful signal — the exact
//     web hex colour — is preserved verbatim (neon-green #10b981, neon-red
//     #ef4444, neon-cyan #00f0ff, blue-400 #60a5fa, purple-400 #c084fc,
//     amber-400 #fbbf24, yellow-400 #facc15, indigo-400 #818cf8). frunk/trunk
//     shared the web Container icon; here they get distinct FR/TR glyphs (their
//     distinct purple/indigo colours are still preserved). The header Zap
//     (text-neon-cyan) becomes a '\u26A1' glyph in #00f0ff.
//   - lucide-react Loader2 (animate-spin text-neon-cyan) -> RN `ActivityIndicator`
//     size="small" color="#00f0ff" — a faithful native spinner.
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `vehicleId` + `size.cols`/`size.rows` are read here).
//   - The CSS grid (grid-cols-2 / @xs:grid-cols-3 / @xs:grid-cols-4 with gap)
//     has no RN equivalent (container queries are unavailable); it is reproduced
//     with flexWrap + a gutter-padding cell technique: compact -> 2 columns
//     (50%), medium -> 3 columns (33.33%), wide -> 4 columns (25%), matching the
//     `@xs` (expanded) column counts since a >=3-col widget is wide enough that
//     the web container query is active.
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.quickActions.* / freshness.* key + {{var}}
//     interpolation intact.
//
// The data hooks are called unchanged: useVehicles() and useVehicleCommand()
// via the native web-parity hooks, so the API paths (/vehicles, POST
// /vehicles/{vehicleId}/command), the command strings (lock, unlock, climate_on,
// climate_off, actuate_frunk, honk_horn, flash_lights, actuate_trunk), and the
// mutation semantics are preserved. State names (vehicles, isFetching, isStale,
// isError, dataUpdatedAt, refetch, id, mutation, activeCommand, isCompact,
// isWide, visibleCommands) and the handleCommand useCallback are preserved
// verbatim. No DOM, react-router, framer-motion, lucide-react, Recharts,
// Leaflet, or old web UI components are imported.

import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useVehicleCommand} from '../../../api/hooks/useVehicleCommand';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.quickActions.* / freshness.* key verbatim and
// applying the same {{var}} interpolation as the web `t`.
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── QuickCommand (web .../CommandQuickActionsWidget QuickCommand) ────────── */

// web `icon: React.ElementType` (a lucide component) -> `glyph: string`; the web
// `color` Tailwind class -> the exact hex it resolves to (see header comment).
interface QuickCommand {
  id: string;
  command: string;
  glyph: string;
  labelKey: string;
  labelFallback: string;
  color: string;
}

const COMMANDS: QuickCommand[] = [
  {id: 'lock', command: 'lock', glyph: 'LK', labelKey: 'widget.quickActions.lock', labelFallback: 'Lock', color: '#10b981'},
  {id: 'unlock', command: 'unlock', glyph: 'UL', labelKey: 'widget.quickActions.unlock', labelFallback: 'Unlock', color: '#ef4444'},
  {id: 'climate_on', command: 'climate_on', glyph: 'CL', labelKey: 'widget.quickActions.climateOn', labelFallback: 'Climate On', color: '#00f0ff'},
  {id: 'climate_off', command: 'climate_off', glyph: 'CO', labelKey: 'widget.quickActions.climateOff', labelFallback: 'Climate Off', color: '#60a5fa'},
  {id: 'frunk', command: 'actuate_frunk', glyph: 'FR', labelKey: 'widget.quickActions.frunk', labelFallback: 'Frunk', color: '#c084fc'},
  {id: 'honk', command: 'honk_horn', glyph: 'HN', labelKey: 'widget.quickActions.horn', labelFallback: 'Horn', color: '#fbbf24'},
  {id: 'flash', command: 'flash_lights', glyph: 'FL', labelKey: 'widget.quickActions.flash', labelFallback: 'Flash', color: '#facc15'},
  {id: 'trunk', command: 'actuate_trunk', glyph: 'TR', labelKey: 'widget.quickActions.trunk', labelFallback: 'Trunk', color: '#818cf8'},
];

const SPINNER_COLOR = '#00f0ff';

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact = false,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status})
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="command-quick-actions-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="command-quick-actions-freshness-dot"
      />
      {!compact && relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  // web freshnessCompact = !title — title-less widgets show a dot-only chip.
  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
      compact={!title}
    />
  );

  // Title-less widgets (the compact branch) overlay the freshness chip in the
  // top-right corner, exactly like the web shell (web L150-164).
  if (!title) {
    return (
      <View style={styles.shell} testID="command-quick-actions-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        <View style={styles.shellBody}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="command-quick-actions-widget">
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        {freshness}
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── ZapGlyph (web header lucide Zap, text-neon-cyan #00f0ff) ─────────────── */

function ZapGlyph({style}: {style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.zapGlyph, style]} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.zapGlyphText}>
        {'\u26A1'}
      </AppText>
    </View>
  );
}

/* ─── CommandButton (web @/components/ui Button variant="ghost") ───────────── */

function CommandButton({
  cmd,
  isCompact,
  cellStyle,
  isRunning,
  disabled,
  onPress,
}: {
  cmd: QuickCommand;
  isCompact: boolean;
  cellStyle: StyleProp<ViewStyle>;
  isRunning: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const label = t(cmd.labelKey, cmd.labelFallback);

  return (
    <View style={cellStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{disabled}}
        disabled={disabled}
        onPress={onPress}
        testID={`command-quick-actions-button-${cmd.id}`}
        style={({pressed}) => [
          styles.commandButton,
          pressed && !disabled && styles.commandButtonPressed,
          disabled && styles.commandButtonDisabled,
        ]}>
        {isRunning ? (
          <ActivityIndicator
            size="small"
            color={SPINNER_COLOR}
            testID={`command-quick-actions-spinner-${cmd.id}`}
          />
        ) : (
          <AppText
            weight="bold"
            accessibilityElementsHidden
            style={[styles.commandGlyph, {color: cmd.color}]}>
            {cmd.glyph}
          </AppText>
        )}
        {!isCompact ? (
          <AppText
            tone="secondary"
            numberOfLines={1}
            style={styles.commandLabel}>
            {label}
          </AppText>
        ) : null}
      </Pressable>
    </View>
  );
}

/* ─── CommandQuickActionsWidget ───────────────────────────────────────────── */

export default function CommandQuickActionsWidget({vehicleId, size}: WidgetProps) {
  const {
    data: vehicles,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const mutation = useVehicleCommand();
  const [activeCommand, setActiveCommand] = useState<string | null>(null);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;

  const handleCommand = useCallback(
    (command: string) => {
      if (!id) {
        return;
      }
      setActiveCommand(command);
      mutation.mutate(
        {vehicleId: id, command},
        {onSettled: () => setActiveCommand(null)},
      );
    },
    [id, mutation],
  );

  // Pick which commands to show based on size.
  const visibleCommands = isCompact
    ? COMMANDS.slice(0, 4)
    : isWide
      ? COMMANDS
      : COMMANDS.slice(0, 6);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.quickActions.title', 'Quick Actions')}
      icon={isCompact ? undefined : <ZapGlyph />}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {id ? (
        <View
          style={
            isCompact
              ? styles.gridCompact
              : isWide
                ? styles.gridWide
                : styles.gridMedium
          }
          testID="command-quick-actions-grid">
          {visibleCommands.map(cmd => {
            const isRunning = activeCommand === cmd.command;
            return (
              <CommandButton
                key={cmd.id}
                cmd={cmd}
                isCompact={isCompact}
                cellStyle={
                  isCompact
                    ? styles.cellCompact
                    : isWide
                      ? styles.cellWide
                      : styles.cell
                }
                isRunning={isRunning}
                disabled={!!activeCommand}
                onPress={() => handleCommand(cmd.command)}
              />
            );
          })}
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <View testID="command-quick-actions-empty">
          <EmptyState
            title={t('widget.quickActions.noVehicle', 'No vehicle selected')}
            message=""
          />
        </View>
      )}
    </WidgetShell>
  );
}

CommandQuickActionsWidget.displayName = 'CommandQuickActionsWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
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
  zapGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  zapGlyphText: {
    color: '#00f0ff',
  },
  // grid-cols-2 @xs:grid-cols-4 gap-2 — 4 columns (25%) via gutter-padding cells.
  gridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    marginVertical: -4,
  },
  // grid-cols-2 @xs:grid-cols-3 gap-2 — 3 columns (33.33%).
  gridMedium: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    marginVertical: -4,
  },
  // grid-cols-2 gap-1.5 h-full items-center — 2 columns (50%), vertically centred.
  gridCompact: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    marginHorizontal: -3,
    marginVertical: -3,
  },
  cell: {
    width: '33.3333%',
    padding: 4,
  },
  cellWide: {
    width: '25%',
    padding: 4,
  },
  cellCompact: {
    width: '50%',
    padding: 3,
  },
  commandButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 4,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  commandButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  commandButtonDisabled: {
    opacity: 0.5,
  },
  commandGlyph: {
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  commandLabel: {
    fontSize: 10,
    lineHeight: 14,
    width: '100%',
    textAlign: 'center',
  },
});
