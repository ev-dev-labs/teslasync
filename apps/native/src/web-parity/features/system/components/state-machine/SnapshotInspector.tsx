// Native parity port of
// web/src/features/system/components/state-machine/SnapshotInspector.tsx.
//
// The web source (256 lines) is the right-rail inspector for the FSM debugger.
// It renders the selected transition (from / to / trigger / duration) plus the
// signal snapshot captured at the transition timestamp, each signal annotated
// with a source-layer badge (L1 / L2 / LOG / STALE) so power users can tell a
// hot in-process read from a cross-pod Redis read or a replayed historical
// value. A "diff vs previous" toggle dims unchanged signals and highlights the
// deltas. When no transition is selected it shows a loading state, an empty
// state, or — when the active window is empty but a `lastTransition` exists
// outside it — a "Jump to last transition" affordance.
//
// Native-targeting decisions (no DOM, no lucide-react, no web UI kit, no
// Tailwind / cn):
//   * `@/components/ui` GlassPanel -> the native GlassPanel primitive. The web
//     Toggle / CopyButton / Caption / PanelTitle / Button shared components are
//     each their own un-ported conversions, so native-safe local equivalents
//     are inlined here (the same self-contained approach the sibling
//     CommandTile port uses for `../commands`).
//   * `@/features/system/components/StateBadge` (which itself depends on the
//     un-ported `@/types/fsm` `getStateColor`) -> an inlined StateBadge plus a
//     native `getStateColor(fsmType, state)` that pre-resolves the web FSM
//     registry's vehicle + telemetry_connection state colours (the two FSMs the
//     debugger drives) to {bg,text,dot}, with the same vehicle-then-neutral
//     fallback the web resolver uses for unknown fsmType / state.
//   * `@/components/data-display` SourceLayerBadge + `SignalSource` -> inlined
//     verbatim (tint map, label map, formatAge). The web hover `<Tooltip>` has
//     no native equivalent, so its content is carried on accessibilityLabel.
//   * The web `<Toggle>` (role="switch") -> RN <Switch>; its `size="sm"` has no
//     RN analogue and is dropped (documented in the sidecar).
//   * The web `<CopyButton>` `navigator.clipboard.writeText` is browser-only.
//     apps/native ships no clipboard module, so a host must register a writer
//     via `registerSnapshotInspectorClipboardWriter`; until then the control
//     renders in an explicit disabled/unavailable state and never claims a copy
//     it did not perform (mirrors the sibling BackendTool clipboard registry).
//   * react-i18next useTranslation -> `useNativeTranslationFallback()` returning
//     the English fallback and interpolating `{{rel}}`, preserving every
//     (key, fallback) pair.
//   * `@/lib/dateFormat` formatRelative, `@/lib/numberFormat` fmtInt, and the
//     local formatValue helper -> ported verbatim as native-safe functions.
//   * Tailwind class strings + `data-testid` -> StyleSheet styles + `testID`.
//
// Line coverage: see SnapshotInspector.tsx.parity.json.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../theme/tokens';
import type { FSMTransition } from '../../../../api/hooks/useFSM';
import type {
  SignalSnapshotResponse,
  SignalSourceLayer,
} from '../../../../api/hooks/useTelemetry';

// Mirrors the web `@/components/data-display` `SignalSource` type name/intent.
// As in web, the explicit member literals collapse against `| string`, but the
// alias documents the canonical L1/L2/LOG/STALE layer values.
export type SignalSource = 'l1' | 'l2' | 'log' | 'stale' | string;

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: Record<string, string>,
) => string;

// The web inspector read `t` from react-i18next. Native parity ships no i18n
// runtime, so this returns the English fallback while still interpolating the
// `{{rel}}` placeholder the empty-outside-window message relies on, preserving
// every (key, fallback) pair.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, vars?: Record<string, string>) => {
      if (!vars) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        name in vars ? vars[name] : `{{${name}}}`,
      );
    },
    [],
  );
}

// Ported verbatim from the web source.
function formatValue(v: unknown): string {
  if (v == null) {
    return '—';
  }
  if (typeof v === 'boolean') {
    return v ? 'true' : 'false';
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : '—';
  }
  if (typeof v === 'string') {
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Native-safe port of `@/lib/dateFormat` formatRelative. The web >7d branch
// falls back to its locale `formatDate`; native uses toLocaleDateString to keep
// the same "absolute date once it's a week old" intent without the web helper.
function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return d.toLocaleDateString();
}

// Native-safe port of `@/lib/numberFormat` safeNumber + fmtInt (decimals 0).
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtInt(v: unknown): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(safeNumber(v));
  }
}

/* ------------------------------------------------------------------ */
/*  Inlined StateBadge (+ native getStateColor)                        */
/* ------------------------------------------------------------------ */

interface StateStyle {
  bg: string;
  text: string;
  dot: string;
}

// Tailwind 400/500 hues used by the web FSM variant theme + state overrides.
const PALETTE = {
  greenSurface: 'rgba(34, 197, 94, 0.10)',
  green: '#4ade80',
  amberSurface: 'rgba(245, 158, 11, 0.10)',
  amber: '#fbbf24',
  redSurface: 'rgba(239, 68, 68, 0.10)',
  red: '#f87171',
  blueSurface: 'rgba(59, 130, 246, 0.10)',
  blue: '#60a5fa',
  cyanSurface: 'rgba(6, 182, 212, 0.10)',
  cyan: '#22d3ee',
  purpleSurface: 'rgba(168, 85, 247, 0.10)',
  purple: '#c084fc',
  indigoSurface: 'rgba(99, 102, 241, 0.10)',
  indigo: '#818cf8',
  graySurface: 'rgba(107, 114, 128, 0.10)',
  gray600Surface: 'rgba(75, 85, 99, 0.10)',
  gray400: '#9ca3af',
  gray500: '#6b7280',
} as const;

// web DEFAULT_STATE (neutral variant).
const NEUTRAL_STATE: StateStyle = {
  bg: PALETTE.graySurface,
  text: colors.textMuted,
  dot: PALETTE.gray400,
};

// Pre-resolved web VEHICLE_STATE_ENTRIES (variant theme + overrides).
const VEHICLE_STATE_COLORS: Record<string, StateStyle> = {
  online: { bg: PALETTE.greenSurface, text: PALETTE.green, dot: PALETTE.green },
  driving: { bg: PALETTE.greenSurface, text: PALETTE.green, dot: PALETTE.green },
  charging: { bg: PALETTE.cyanSurface, text: PALETTE.cyan, dot: PALETTE.cyan },
  parked: { bg: PALETTE.purpleSurface, text: PALETTE.purple, dot: PALETTE.purple },
  updating: { bg: PALETTE.indigoSurface, text: PALETTE.indigo, dot: PALETTE.indigo },
  asleep: NEUTRAL_STATE,
  offline: { bg: PALETTE.gray600Surface, text: colors.textMuted, dot: PALETTE.gray500 },
};

// Pre-resolved web TELEMETRY_CONNECTION_STATE_ENTRIES.
const TELEMETRY_STATE_COLORS: Record<string, StateStyle> = {
  unknown: NEUTRAL_STATE,
  connecting: { bg: PALETTE.amberSurface, text: PALETTE.amber, dot: PALETTE.amber },
  streaming: { bg: PALETTE.greenSurface, text: PALETTE.green, dot: PALETTE.green },
  stale: { bg: PALETTE.amberSurface, text: PALETTE.amber, dot: PALETTE.amber },
  disconnected: { bg: PALETTE.redSurface, text: PALETTE.red, dot: PALETTE.red },
  polling_only: { bg: PALETTE.blueSurface, text: PALETTE.blue, dot: PALETTE.blue },
};

const FSM_STATE_COLORS: Record<string, Record<string, StateStyle>> = {
  vehicle: VEHICLE_STATE_COLORS,
  telemetry_connection: TELEMETRY_STATE_COLORS,
};

// Native parity for web `getStateColor`: unknown fsmType -> vehicle map;
// unknown state -> DEFAULT_STATE (neutral).
function getStateColor(fsmType: string, state: string): StateStyle {
  const map = FSM_STATE_COLORS[fsmType] ?? FSM_STATE_COLORS.vehicle;
  return map[state.toLowerCase()] ?? NEUTRAL_STATE;
}

function StateBadge({ state, fsmType }: { state: string; fsmType: string }) {
  const color = getStateColor(fsmType, state);
  return (
    <View style={[styles.stateBadge, { backgroundColor: color.bg }]}>
      <View style={[styles.stateDot, { backgroundColor: color.dot }]} />
      <AppText style={[styles.stateLabel, { color: color.text }]}>{state}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined SourceLayerBadge                                           */
/* ------------------------------------------------------------------ */

interface SourceStyle {
  bg: string;
  border: string;
  text: string;
  label: string;
  descKey: string;
  descFallback: string;
}

const SOURCE_STYLE: Record<string, SourceStyle> = {
  l1: {
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.30)',
    text: '#a7f3d0',
    label: 'L1',
    descKey: 'sourceLayer.l1.desc',
    descFallback: 'Read from the in-process SignalStore (hot path, freshest).',
  },
  l2: {
    bg: 'rgba(59, 130, 246, 0.15)',
    border: 'rgba(59, 130, 246, 0.30)',
    text: '#bfdbfe',
    label: 'L2',
    descKey: 'sourceLayer.l2.desc',
    descFallback: 'Read from Redis cross-pod cache (legacy entry; freshness unknown).',
  },
  log: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
    label: 'LOG',
    descKey: 'sourceLayer.log.desc',
    descFallback: 'Replayed from signal_log (durable history).',
  },
  stale: {
    bg: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(245, 158, 11, 0.30)',
    text: '#fde68a',
    label: 'STALE',
    descKey: 'sourceLayer.stale.desc',
    descFallback: 'Redis-backed value older than the 2-minute freshness window.',
  },
  unknown: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
    label: '—',
    descKey: 'sourceLayer.unknown.desc',
    descFallback: 'Source layer unknown.',
  },
};

function formatAge(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) {
    return null;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)} min`;
  }
  if (ms < 86_400_000) {
    return `${(ms / 3_600_000).toFixed(1)} h`;
  }
  return `${(ms / 86_400_000).toFixed(1)} d`;
}

function SourceLayerBadge({
  source,
  ageMs,
}: {
  source: SignalSource | null | undefined;
  ageMs?: number | null;
}) {
  const t = useNativeTranslationFallback();
  const key = (source ?? 'unknown').toLowerCase();
  const style = SOURCE_STYLE[key] ?? SOURCE_STYLE.unknown;
  const ageText = formatAge(ageMs);
  // The web hover Tooltip has no RN analogue; its content rides on the
  // accessibilityLabel so screen readers still surface the layer description.
  const tooltip = ageText
    ? `${t(style.descKey, style.descFallback)} (${t('sourceLayer.age', 'age')}: ${ageText})`
    : t(style.descKey, style.descFallback);

  return (
    <View
      accessibilityLabel={tooltip}
      accessibilityRole="text"
      style={[styles.sourceBadge, { backgroundColor: style.bg, borderColor: style.border }]}
      testID="source-layer-badge">
      <AppText style={[styles.sourceLabel, { color: style.text }]}>{style.label}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined CopyButton (clipboard provider registry)                   */
/* ------------------------------------------------------------------ */

type ClipboardWriter = (text: string) => Promise<void> | void;
let clipboardWriter: ClipboardWriter | null = null;

// The native build ships no clipboard module (no `@react-native-clipboard/...`
// dependency), so the copy control stays disabled/unavailable until a host
// registers a real writer. Exposing the setter keeps the affordance honest: it
// only flips to "copied" after a write resolves, never claiming a copy it did
// not perform.
export function registerSnapshotInspectorClipboardWriter(
  writer: ClipboardWriter | null,
): () => void {
  clipboardWriter = writer;
  return () => {
    if (clipboardWriter === writer) {
      clipboardWriter = null;
    }
  };
}

// lucide Copy -> repo `copy` glyph; lucide CheckCircle (copied state) -> the
// repo `successFilled` glyph.
const COPY_GLYPH = getSemanticIconDefinition('copy').glyph;
const COPIED_GLYPH = getSemanticIconDefinition('successFilled').glyph;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const available = clipboardWriter != null;

  const handleCopy = useCallback(async () => {
    if (!clipboardWriter) {
      return;
    }
    try {
      await clipboardWriter(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('CopyButton: clipboard write failed', err);
    }
  }, [text]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={handleCopy}
      style={({ pressed }) => [
        styles.copyButton,
        !available && styles.copyButtonDisabled,
        pressed && available && styles.copyButtonPressed,
      ]}>
      <AppText style={styles.copyGlyph}>{copied ? COPIED_GLYPH : COPY_GLYPH}</AppText>
      <AppText style={styles.copyLabel}>{label}</AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined Toggle / PanelTitle / Caption                              */
/* ------------------------------------------------------------------ */

const TOGGLE_TRACK = { false: PALETTE.gray500, true: colors.accent };

// web Toggle (role="switch"). `size="sm"` has no RN <Switch> analogue and is
// dropped; the visible label remains tappable to toggle, matching web.
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <View style={styles.toggle}>
      <Switch
        onValueChange={onChange}
        thumbColor={colors.textPrimary}
        trackColor={TOGGLE_TRACK}
        value={checked}
      />
      {label ? (
        <Pressable accessibilityRole="button" onPress={() => onChange(!checked)}>
          <AppText style={styles.toggleLabel} tone="secondary">
            {label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// web PanelTitle (typography role `panelTitle`: text-base font-semibold primary).
function PanelTitle({ children }: { children: ReactNode }) {
  return <AppText style={styles.panelTitle}>{children}</AppText>;
}

// web Caption (typography role `caption`: text-xs muted).
function Caption({ children }: { children: ReactNode }) {
  return (
    <AppText tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  SnapshotInspector                                                  */
/* ------------------------------------------------------------------ */

export interface SnapshotInspectorProps {
  fsmType: string;
  transition?: FSMTransition | null;
  /** Snapshot at the transition timestamp. */
  snapshot?: SignalSnapshotResponse | null;
  /** Snapshot at the previous transition (for diff mode). */
  previousSnapshot?: SignalSnapshotResponse | null;
  /** Optional loading hint forwarded to the panel. */
  loading?: boolean;
  /** Most recent transition (in or outside the window). */
  lastTransition?: FSMTransition | null;
  /** Number of selectable transitions inside the active window. */
  inWindowCount?: number;
  /** Switch to Freeze mode and select `lastTransition`. */
  onJumpToLast?: () => void;
  style?: StyleProp<ViewStyle>;
}

interface SnapshotRow {
  name: string;
  value: unknown;
  source?: SignalSourceLayer;
  ageMs?: number;
  changed: boolean;
  previous?: unknown;
}

export function SnapshotInspector({
  fsmType,
  transition,
  snapshot,
  previousSnapshot,
  loading,
  lastTransition,
  inWindowCount,
  onJumpToLast,
  style,
}: SnapshotInspectorProps) {
  const t = useNativeTranslationFallback();
  const [diffMode, setDiffMode] = useState(false);

  const rows = useMemo<SnapshotRow[]>(() => {
    if (!snapshot?.signals) {
      return [];
    }
    const prev = previousSnapshot?.signals ?? {};
    return Object.entries(snapshot.signals)
      .map(([name, entry]) => {
        const prevEntry = prev[name];
        const changed =
          previousSnapshot != null &&
          JSON.stringify(prevEntry?.value ?? null) !== JSON.stringify(entry?.value ?? null);
        return {
          name,
          value: entry?.value,
          source: entry?.source,
          ageMs: entry?.age_ms,
          changed,
          previous: prevEntry?.value,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, previousSnapshot]);

  const copyPayload = useMemo(() => {
    if (!transition || !snapshot) {
      return '';
    }
    return JSON.stringify(
      {
        transition,
        snapshot: snapshot.signals,
        at: snapshot.at,
      },
      null,
      2,
    );
  }, [transition, snapshot]);

  if (!transition) {
    if (loading) {
      return (
        <GlassPanel style={[styles.panel, style]}>
          <View style={styles.centerState} testID="snapshot-inspector-loading">
            <AppText style={styles.mutedText}>
              {t('debugger.inspector.loading', 'Loading…')}
            </AppText>
          </View>
        </GlassPanel>
      );
    }
    if ((inWindowCount ?? 0) === 0 && lastTransition && onJumpToLast) {
      return (
        <GlassPanel style={[styles.panel, styles.panelCentered, style]}>
          <AppText
            style={[styles.mutedText, styles.centeredText]}
            testID="snapshot-inspector-outside-window">
            {t(
              'debugger.inspector.emptyOutsideWindow',
              'Nothing in the current window. Last transition {{rel}}.',
              { rel: formatRelative(lastTransition.ts) },
            )}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={onJumpToLast}
            style={({ pressed }) => [styles.jumpButton, pressed && styles.jumpButtonPressed]}
            testID="snapshot-inspector-jump">
            <AppText style={styles.jumpButtonLabel}>
              {t('debugger.inspector.jumpToLast', 'Jump to last transition')}
            </AppText>
          </Pressable>
        </GlassPanel>
      );
    }
    return (
      <GlassPanel style={[styles.panel, style]}>
        <View style={styles.centerState} testID="snapshot-inspector-empty">
          <AppText style={styles.mutedText}>
            {t('debugger.inspector.empty', 'Select a transition to inspect its snapshot')}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const durationMs = transition.details?.duration_in_state_ms;
  const durationLabel = (typeof durationMs === 'number' ? fmtInt(durationMs) : null) ?? '—';

  return (
    <GlassPanel style={[styles.panel, style]}>
      <View style={styles.stack}>
        <View style={styles.headerRow}>
          <PanelTitle>{t('debugger.inspector.title', 'Transition snapshot')}</PanelTitle>
          <View style={styles.headerActions}>
            {copyPayload ? (
              <CopyButton label={t('debugger.inspector.copy', 'Copy snapshot')} text={copyPayload} />
            ) : null}
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Caption>{t('debugger.inspector.from', 'From')}</Caption>
            <View style={styles.metaValue}>
              <StateBadge fsmType={fsmType} state={transition.from_state} />
            </View>
          </View>
          <View style={styles.metaCell}>
            <Caption>{t('debugger.inspector.to', 'To')}</Caption>
            <View style={styles.metaValue}>
              <StateBadge fsmType={fsmType} state={transition.to_state} />
            </View>
          </View>
          <View style={styles.metaCell}>
            <Caption>{t('debugger.inspector.trigger', 'Trigger')}</Caption>
            <AppText style={[styles.metaValue, styles.primaryText]}>
              {transition.trigger || '—'}
            </AppText>
          </View>
          <View style={styles.metaCell}>
            <Caption>{t('debugger.inspector.duration', 'Duration')}</Caption>
            <AppText style={[styles.metaValue, styles.primaryText]}>{durationLabel} ms</AppText>
          </View>
        </View>

        <View style={styles.signalsHeader}>
          <PanelTitle>{t('debugger.inspector.signalsTitle', 'Signals at transition')}</PanelTitle>
          <Toggle
            checked={diffMode}
            label={t('debugger.inspector.diffMode', 'Diff vs previous')}
            onChange={setDiffMode}
          />
        </View>

        {rows.length === 0 ? (
          <View style={styles.noSignals}>
            <AppText style={[styles.mutedText, styles.centeredText]}>
              {t('debugger.inspector.noSignals', 'No signals captured for this transition')}
            </AppText>
          </View>
        ) : (
          <ScrollView nestedScrollEnabled style={styles.rowsScroll}>
            {rows.map(row => {
              const dim = diffMode && !row.changed;
              const highlight = diffMode && row.changed;
              return (
                <View
                  key={row.name}
                  style={[
                    styles.row,
                    highlight ? styles.rowHighlight : styles.rowDefault,
                    dim && styles.rowDim,
                  ]}>
                  <View style={styles.rowMain}>
                    <AppText numberOfLines={1} style={styles.rowName}>
                      {row.name}
                    </AppText>
                    <AppText style={styles.rowValue}>{formatValue(row.value)}</AppText>
                    {diffMode && row.changed && row.previous !== undefined ? (
                      <AppText style={styles.rowPrevious}>{formatValue(row.previous)}</AppText>
                    ) : null}
                  </View>
                  <SourceLayerBadge ageMs={row.ageMs} source={row.source} />
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </GlassPanel>
  );
}

SnapshotInspector.displayName = 'SnapshotInspector';

const styles = StyleSheet.create({
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  centeredText: {
    textAlign: 'center',
  },
  copyButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  copyButtonDisabled: {
    opacity: 0.48,
  },
  copyButtonPressed: {
    opacity: 0.82,
  },
  copyGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  copyLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  jumpButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  jumpButtonLabel: {
    color: colors.background,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 16,
  },
  jumpButtonPressed: {
    opacity: 0.82,
  },
  metaCell: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 120,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metaValue: {
    marginTop: spacing.xs,
  },
  mutedText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  noSignals: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  panel: {
    padding: spacing.md,
  },
  panelCentered: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 160,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  primaryText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  rowDefault: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: colors.border,
  },
  rowDim: {
    opacity: 0.4,
  },
  rowHighlight: {
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
    borderColor: 'rgba(251, 191, 36, 0.30)',
  },
  rowMain: {
    flexShrink: 1,
    flex: 1,
  },
  rowName: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
    fontSize: 11,
    lineHeight: 14,
  },
  rowPrevious: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
    textDecorationLine: 'line-through',
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  rowsScroll: {
    maxHeight: 480,
  },
  signalsHeader: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  sourceBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 4,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  sourceLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    lineHeight: 13,
  },
  stack: {
    gap: spacing.lg,
  },
  stateBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  stateDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  stateLabel: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  toggle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
});
