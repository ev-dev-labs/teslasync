// Native parity port of
// web/src/features/system/components/status/SLOTrackingCard.tsx.
//
// Personal SLO visualisation (web L1-14). A personal-goal surface for
// self-hosted operators (no customer SLA framing): a window selector spanning
// 24h / 7d / 30d / 90d / 1y, the current uptime percentage from
// GET /api/v1/status/uptime?window=…, and a `historical_source` discriminator
// that decides whether a "current snapshot" caveat is shown. The personal
// target line defaults to 99% and is persisted so it survives reloads. The
// Window union, WINDOW_LABEL map, UptimeWindow shape, TARGET_KEY, the
// loadTarget()/save validation (0 < n <= 100, else 99), the queryKey
// ['status-uptime', win], the `/status/uptime?window=…` path, the 60s
// refetchInterval, the pct/tone/handleSaveTarget logic, and the English strings
// (the source uses literal English, no react-i18next) are preserved verbatim.
//
// Native adaptations vs. the web source (behaviour / state / keys kept):
//   - lucide-react `Target` / `Info` (web L18, L94, L155) -> canonical native
//     SemanticIcon glyphs ('target' -> TARGET_GLYPH, 'info' -> INFO_GLYPH),
//     rendered as inline text in the icon slots, matching the sibling
//     AnomalyInlineRow port.
//   - `@/components/ui` GlassPanel (web L19) -> the native GlassPanel; `Button`
//     (Save/Cancel/Edit, size="sm", variant primary/ghost) -> an inline native
//     ActionButton (Pressable) mirroring the sibling IncidentForm DialogAction;
//     `Input` (type="number") -> a single-line <TextInput> (keyboardType
//     decimal-pad for the 0.1 step) keeping value/onChange->onChangeText and the
//     aria-label. The HTML min/max/step attributes have no RN analog — the
//     1..100 bound is enforced by handleSaveTarget exactly as on web.
//   - `@/lib/cn` (web L21) -> dropped; Tailwind class merges become RN style
//     arrays (StyleSheet + dynamic color/selected styles).
//   - `@/lib/numberFormat` fmtPercent (web L22) -> an inline en-US fmtNumber/
//     fmtPercent (no settings-precision sync on native), matching the sibling
//     BatteryHealthPage port; called with the same 2-decimal precision.
//   - `window.localStorage` (web L46-51, L65-69) -> a native-safe in-memory
//     storage shim (RN has no synchronous localStorage and AsyncStorage is not
//     on the native dependency manifest). The loadTarget()/setItem call sites
//     are preserved verbatim; persistence is session-scoped (documented).
//   - role="tablist"/role="tab" + aria-selected -> RN accessibilityRole
//     tablist/tab + accessibilityState.selected; aria-live="polite" on the big
//     number -> accessibilityLiveRegion="polite".
// No DOM / Recharts / Leaflet / lucide / old web-UI imports reach the native
// output. See the .parity.json sidecar for the line-by-line map.

import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, TextInput, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {request} from '../../../../api/client';

// Web lucide <Target/> / <Info/> -> canonical native SemanticIcon glyphs.
const TARGET_GLYPH = getSemanticIconDefinition('target').glyph;
const INFO_GLYPH = getSemanticIconDefinition('info').glyph;

// Tailwind palette hexes pinned from the web tone()/tab/caveat classes.
const GREEN_300 = '#86efac'; // text-green-300 (pct >= target)
const AMBER_300 = '#fcd34d'; // text-amber-300 (pct >= target - 1)
const RED_300 = '#fca5a5'; // text-red-300 (below target - 1, and error text)
const CYAN_200 = '#a5f3fc'; // selected tab text-cyan-200
const CYAN_500_20 = 'rgba(6, 182, 212, 0.2)'; // selected tab bg-cyan-500/20
const CYAN_400_40 = 'rgba(34, 211, 238, 0.4)'; // selected tab ring-cyan-400/40
const AMBER_200_80 = 'rgba(253, 230, 138, 0.8)'; // caveat text-amber-200/80
const WHITE_04 = 'rgba(255, 255, 255, 0.04)'; // unselected tab bg-white/[0.04]
const WHITE_08 = 'rgba(255, 255, 255, 0.08)'; // hover bg-white/[0.08] -> pressed

type Window = '24h' | '7d' | '30d' | '90d' | '1y';

const WINDOW_LABEL: Record<Window, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
};

interface UptimeWindow {
  window: string;
  uptime_percent: number;
  healthy_count: number;
  total_count: number;
  generated_at: string;
  historical_source: string;
  note?: string;
}

// ---- Native-safe storage shim (web window.localStorage) ---------------------
// RN has no synchronous localStorage and AsyncStorage isn't on the native
// dependency manifest, so this is an in-memory map: it keeps the read/write
// call sites verbatim while being session-scoped (documented).
const memoryStore = new Map<string, string>();
const safeStorage = {
  getItem(key: string): string | null {
    return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    memoryStore.set(key, value);
  },
};

const TARGET_KEY = 'teslasync.status.slo.target';

function loadTarget(): number {
  const v = safeStorage.getItem(TARGET_KEY);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 99;
}

// ---- numberFormat (web @/lib/numberFormat fmtPercent) — en-US, precision 2 --
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals ?? 2)}%`;
}

export function SLOTrackingCard(): React.ReactElement {
  const [win, setWin] = useState<Window>('30d');
  const [target, setTargetState] = useState<number>(() => loadTarget());
  const [editing, setEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState<string>(String(target));

  const {data, isLoading, error} = useQuery({
    queryKey: ['status-uptime', win],
    queryFn: ({signal}) =>
      request<UptimeWindow>(`/status/uptime?window=${win}`, {signal}),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    safeStorage.setItem(TARGET_KEY, String(target));
  }, [target]);

  const pct = data?.uptime_percent ?? null;
  const toneColor = useMemo(() => {
    if (pct == null) {
      return colors.textMuted;
    }
    if (pct >= target) {
      return GREEN_300;
    }
    if (pct >= target - 1) {
      return AMBER_300;
    }
    return RED_300;
  }, [pct, target]);

  const handleSaveTarget = () => {
    const n = Number(draftTarget);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      setDraftTarget(String(target));
      setEditing(false);
      return;
    }
    setTargetState(n);
    setEditing(false);
  };

  const showCaveat =
    data?.historical_source != null && data.historical_source !== 'series';

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <AppText
            accessible={false}
            style={styles.headerIcon}
            variant="caption"
            weight="bold">
            {TARGET_GLYPH}
          </AppText>
          <AppText style={styles.headerTitle} weight="semibold">
            Uptime &amp; SLO
          </AppText>
        </View>
        <View style={styles.headerRight}>
          {editing ? (
            <>
              <AppText style={styles.metaText}>Target</AppText>
              <TextInput
                accessibilityLabel="Target uptime percentage"
                keyboardType="decimal-pad"
                onChangeText={setDraftTarget}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={draftTarget}
              />
              <AppText style={styles.metaText}>%</AppText>
              <ActionButton
                label="Save"
                onPress={handleSaveTarget}
                variant="primary"
              />
              <ActionButton
                label="Cancel"
                onPress={() => {
                  setEditing(false);
                  setDraftTarget(String(target));
                }}
                variant="ghost"
              />
            </>
          ) : (
            <>
              <AppText style={styles.metaText}>{`Target ${target}%`}</AppText>
              <ActionButton
                label="Edit"
                onPress={() => setEditing(true)}
                variant="ghost"
              />
            </>
          )}
        </View>
      </View>

      <View style={styles.pctRow}>
        <AppText
          accessibilityLiveRegion="polite"
          style={[styles.pctValue, {color: toneColor}]}>
          {pct == null ? '—' : fmtPercent(pct, 2)}
        </AppText>
        <AppText style={styles.pctMeta}>
          {`${WINDOW_LABEL[win]} · ${data?.healthy_count ?? '—'} / ${
            data?.total_count ?? '—'
          } components healthy`}
        </AppText>
      </View>

      <View
        accessibilityLabel="Uptime window selector"
        accessibilityRole="tablist"
        style={styles.tabRow}>
        {(Object.keys(WINDOW_LABEL) as Window[]).map(w => {
          const selected = win === w;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{selected}}
              key={w}
              onPress={() => setWin(w)}
              style={({pressed}) => [
                styles.tab,
                selected ? styles.tabSelected : styles.tabUnselected,
                pressed && !selected && styles.tabPressed,
              ]}>
              <AppText
                style={[
                  styles.tabLabel,
                  selected ? styles.tabLabelSelected : styles.tabLabelUnselected,
                ]}>
                {w}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {showCaveat ? (
        <View style={styles.caveatRow}>
          <AppText
            accessible={false}
            style={styles.caveatIcon}
            variant="caption"
            weight="bold">
            {INFO_GLYPH}
          </AppText>
          <AppText style={styles.caveatText}>
            {data?.note ??
              'Per-window historical uptime requires the heartbeat history backend (planned). This figure reflects the current snapshot.'}
          </AppText>
        </View>
      ) : null}

      {isLoading ? (
        <AppText style={styles.loadingText}>Loading uptime…</AppText>
      ) : null}
      {error ? (
        <AppText style={styles.errorText}>Failed to load uptime data.</AppText>
      ) : null}
    </GlassPanel>
  );
}

SLOTrackingCard.displayName = 'SLOTrackingCard';

// ---- Inline ActionButton (web @/components/ui Button, size="sm") ------------
function ActionButton({
  label,
  onPress,
  variant,
}: {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'ghost';
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        pressed && styles.pressed,
      ]}>
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.ghostButtonText
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  caveatIcon: {
    color: AMBER_200_80,
    marginTop: 1,
  },
  caveatRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 6, // gap-1.5
    marginTop: 12, // mt-3
  },
  caveatText: {
    color: AMBER_200_80, // text-amber-200/80
    flexShrink: 1,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  errorText: {
    color: RED_300, // text-red-300
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginTop: 12, // mt-3
  },
  ghostButton: {
    backgroundColor: 'transparent',
  },
  ghostButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  headerIcon: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: 6, // gap-1.5
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12, // gap-3
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 12,
    minHeight: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: 80, // w-20
  },
  loadingText: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginTop: 12, // mt-3
  },
  metaText: {
    color: colors.textMuted, // text-xs text-[var(--text-muted)]
    fontSize: 12,
  },
  panel: {
    padding: 16, // p-4
  },
  pctMeta: {
    color: colors.textMuted, // text-xs text-[var(--text-muted)]
    fontSize: 12,
  },
  pctRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12, // gap-3
    marginTop: 12, // mt-3
  },
  pctValue: {
    fontSize: 30, // text-3xl
    fontVariant: ['tabular-nums'], // tabular-nums
    fontWeight: '600', // font-semibold
    lineHeight: 36,
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 12,
  },
  tab: {
    borderRadius: 999, // rounded-full
    borderWidth: 1,
    paddingHorizontal: 12, // px-3
    paddingVertical: 4, // py-1
  },
  tabLabel: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
  },
  tabLabelSelected: {
    color: CYAN_200, // text-cyan-200
  },
  tabLabelUnselected: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
  },
  tabPressed: {
    backgroundColor: WHITE_08, // hover:bg-white/[0.08]
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4, // gap-1
    marginTop: 12, // mt-3
  },
  tabSelected: {
    backgroundColor: CYAN_500_20, // bg-cyan-500/20
    borderColor: CYAN_400_40, // ring-1 ring-cyan-400/40
  },
  tabUnselected: {
    backgroundColor: WHITE_04, // bg-white/[0.04]
    borderColor: 'transparent',
  },
});
