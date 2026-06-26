// Native parity port of
// web/src/features/settings/components/RegionSettings.tsx.
//
// `RegionSettings` is the Settings → Tesla "Region & API" panel: a glass card
// with a header (globe IconBox + title/subtitle on the left; an optional
// last-synced label + a "Refresh" button on the right), followed by either a
// two-up grid of read-only cards (Region code + Fleet API base URL) or an empty
// state prompting the user to refresh. Every state name (`t`, `toast`,
// `regionConfig`, `regionRefresh`), the `useTeslaUserRegion` /
// `useRefreshTeslaRegion` API paths (via the reused hooks — /tesla/user/region
// + /tesla/user/region/refresh), the
// `regionRefresh.mutate(undefined, { onSuccess, onError })` refresh behaviour,
// the `regionConfig?.data?.region` / `fleet_api_base_url ?? '—'` null-safe reads,
// and every `t(key, 'English')` i18n key + fallback are preserved verbatim.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7), each documented in the parity sidecar:
//   - react-i18next `useTranslation('settings')` (L1) -> a local key-preserving
//     shim returning the inline English fallback (apps/native lacks
//     react-i18next; same approach as the ActiveOrdersSection port). Every i18n
//     key is referenced verbatim.
//   - `@/api/hooks/useUser` useTeslaUserRegion/useRefreshTeslaRegion (L2) -> the
//     reused web-parity useUser hooks (same TanStack query/mutation + paths +
//     TeslaConfigEnvelope<TeslaRegionData> shape).
//   - `@/components/ui` GlassPanel/Button/IconBox (L3): GlassPanel -> the shared
//     native GlassPanel; Button (variant="secondary" size="sm" + spinner icon)
//     -> a local Pressable "RefreshButton" (neutral surfaceRaised; an
//     ActivityIndicator while pending mirrors the web `animate-spin`); IconBox
//     color="green" -> a local success-tinted rounded box (successSurface fill +
//     successBorder ring) wrapping the decorative globe glyph (the web green
//     ring/tint is the visual intent).
//   - `@/components/feedback` EmptyState (L4) -> a local info-glyph + message
//     block; the web's no-action note (transient empty state, no specific
//     recovery action) is preserved — Refresh in the header is the recovery.
//   - `@/components/motion` FadeIn (L5) -> the reused web-parity motion FadeIn
//     (delay 0.04s preserved).
//   - `@/components/feedback/Toast` useToast (L6) -> a local lightweight in-panel
//     banner host preserving the `success(title)` / `error(title, detail)`
//     contract (the ActiveOrdersSection precedent). NOTE the reused
//     `useRefreshTeslaRegion` hook also surfaces its own native toast; this
//     component's banner mirrors the web component's *own* explicit toast,
//     exactly as the web double-fires.
//   - `@/lib/cn` (L7) -> dropped: React Native has no className, so the
//     conditional `animate-spin` class becomes the busy ActivityIndicator and
//     all static class styling moves to StyleSheet.
//   - `@/lib/dateFormat` formatDateTime (L8) -> an inlined native-safe copy
//     (nullish/invalid -> '—'; full date + time via toLocaleString), the
//     ActiveOrdersSection precedent.
//   - lucide-react icons Globe/RefreshCw/Info (L9) -> decorative emoji glyphs via
//     `Glyph` (accessibility-hidden); the adjacent translated label / message
//     carries the meaning.
//
// Tailwind -> px (1 unit = 4px): p-6 -> 24, p-4 -> 16, gap-3 -> 12, gap-4 -> 16,
// mb-1 -> 4, space-y-4 -> 16, rounded-lg -> 8, rounded-xl -> 12, text-lg -> 18,
// text-base -> 16, text-sm -> 14, text-xs -> 12, text-[11px] -> 11, h-10/w-10 ->
// 40/40, h-5/w-5 icon. `uppercase tracking-wider` -> textTransform 'uppercase' +
// letterSpacing; `break-all` -> RN Text wraps the long URL by default. The web
// `bg-white/[0.02]` card fill + `--border-subtle` border map to the closest
// tokens (literal white/0.02 + colors.border). The single-column-then-2-col
// `grid-cols-1 sm:grid-cols-2` collapses to the mobile-first single column. No
// DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useRefreshTeslaRegion, useTeslaUserRegion} from '../../../api/hooks/useUser';
import {FadeIn} from '../../../components/motion';

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

/* ── i18n shim (web react-i18next `useTranslation`) ───────────────── */
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, preserving intent.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

/* ── dateFormat (inlined from @/lib/dateFormat) ───────────────────── */
// formatDateTime -> full date + time; nullish/invalid -> '—' placeholder.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ── Glyph (decorative lucide-icon stand-in) ──────────────────────── */
function Glyph({children, style}: {children: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText accessibilityElementsHidden importantForAccessibility="no" style={style}>
      {children}
    </AppText>
  );
}

/* ── useToast (web @/components/feedback/Toast useToast) ───────────── */
// Lightweight in-panel banner host preserving the `success(title)` /
// `error(title, detail)` contract; auto-dismisses after a few seconds.
interface ActiveToast {
  id: number;
  type: 'success' | 'error';
  title: string;
  detail?: string;
}

function useToast() {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((next: ActiveToast) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setActive(next);
    timer.current = setTimeout(() => setActive(null), next.type === 'error' ? 6000 : 5000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const success = useCallback(
    (title: string, detail?: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'success', title, detail});
    },
    [show],
  );

  const error = useCallback(
    (title: string, detail?: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'error', title, detail});
    },
    [show],
  );

  const node = active ? (
    <View style={styles.toastWrap}>
      <GlassPanel style={[styles.toast, active.type === 'error' ? styles.toastError : styles.toastSuccess]}>
        <AppText style={styles.toastTitle} weight="semibold">
          {active.title}
        </AppText>
        {active.detail ? (
          <AppText style={styles.toastDetail} tone="secondary" variant="caption">
            {active.detail}
          </AppText>
        ) : null}
      </GlassPanel>
    </View>
  ) : null;

  return {success, error, node};
}

export function RegionSettings() {
  const {t} = useTranslation('settings');
  const toast = useToast();
  const {data: regionConfig} = useTeslaUserRegion();
  const regionRefresh = useRefreshTeslaRegion();

  return (
    <>
      <FadeIn delay={0.04}>
        <GlassPanel style={styles.panel}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBox}>
                <Glyph style={styles.iconBoxGlyph}>🌐</Glyph>
              </View>
              <View style={styles.headerTitleBlock}>
                <AppText style={styles.title} weight="semibold">
                  {t('region.title', 'Region & API')}
                </AppText>
                <AppText style={styles.subtitle} tone="muted">
                  {t('region.subtitle', 'Tesla account region and Fleet API endpoint')}
                </AppText>
              </View>
            </View>
            <View style={styles.headerRight}>
              {regionConfig?.fetched_at ? (
                <AppText style={styles.syncedLabel} tone="muted">
                  {t('region.lastSynced', 'Synced')} {formatDateTime(regionConfig.fetched_at)}
                </AppText>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('region.refresh', 'Refresh')}
                accessibilityState={{disabled: regionRefresh.isPending}}
                disabled={regionRefresh.isPending}
                onPress={() =>
                  regionRefresh.mutate(undefined, {
                    onSuccess: () => toast.success(t('toast.regionRefreshed', 'Region info refreshed')),
                    onError: (err: Error) =>
                      toast.error(t('toast.regionFailed', 'Failed to refresh region'), err.message),
                  })
                }
                style={({pressed}) => [
                  styles.refreshBtn,
                  regionRefresh.isPending && styles.refreshBtnDisabled,
                  pressed && !regionRefresh.isPending && styles.refreshBtnPressed,
                ]}>
                {regionRefresh.isPending ? (
                  <ActivityIndicator color={colors.textPrimary} size="small" />
                ) : (
                  <Glyph style={styles.refreshGlyph}>🔄</Glyph>
                )}
                <AppText style={styles.refreshLabel} weight="semibold">
                  {t('region.refresh', 'Refresh')}
                </AppText>
              </Pressable>
            </View>
          </View>

          {regionConfig?.data?.region ? (
            <View style={styles.grid}>
              <View style={styles.infoCard}>
                <AppText style={styles.infoLabel} tone="muted">
                  {t('region.regionCode', 'Region')}
                </AppText>
                <AppText style={styles.infoValue} weight="semibold">
                  {regionConfig.data.region}
                </AppText>
              </View>
              <View style={styles.infoCard}>
                <AppText style={styles.infoLabel} tone="muted">
                  {t('region.fleetApiUrl', 'Fleet API Base URL')}
                </AppText>
                <AppText style={styles.infoValueMono}>
                  {regionConfig.data.fleet_api_base_url ?? '—'}
                </AppText>
              </View>
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; the header Refresh button is the only recovery action.
            <View style={styles.emptyState}>
              <Glyph style={styles.emptyGlyph}>ℹ️</Glyph>
              <AppText style={styles.emptyMessage} tone="muted">
                {t('region.noData', 'No region data yet. Click Refresh to fetch from Tesla.')}
              </AppText>
            </View>
          )}
        </GlassPanel>
      </FadeIn>
      {toast.node}
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 24, // p-6
    gap: 16, // space-y-4
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12, // gap-3
    flexShrink: 1,
  },
  iconBox: {
    width: 40, // h-10 w-10
    height: 40,
    borderRadius: 12, // rounded-xl
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successSurface, // IconBox color="green" bg
    borderWidth: 1,
    borderColor: colors.successBorder, // ring-1
  },
  iconBoxGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  headerTitleBlock: {
    flexShrink: 1,
  },
  title: {
    fontSize: 16, // text-base
    lineHeight: 22,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  syncedLabel: {
    fontSize: 11, // text-[11px]
    lineHeight: 14,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised, // Button variant="secondary"
  },
  refreshBtnDisabled: {
    opacity: 0.5, // disabled:opacity-50
  },
  refreshBtnPressed: {
    opacity: 0.82,
  },
  refreshGlyph: {
    fontSize: 13, // h-3.5 w-3.5
    lineHeight: 16,
  },
  refreshLabel: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  grid: {
    gap: 16, // grid gap-4 (mobile-first single column; sm:grid-cols-2 collapses)
  },
  infoCard: {
    borderRadius: 8, // rounded-lg
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // bg-white/[0.02]
    borderWidth: 1,
    borderColor: colors.border, // --border-subtle
    padding: 16, // p-4
    gap: 4, // mb-1 between label and value
  },
  infoLabel: {
    fontSize: 12, // text-xs
    lineHeight: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.8, // tracking-wider
  },
  infoValue: {
    fontSize: 18, // text-lg
    lineHeight: 24,
    color: colors.textPrimary,
  },
  infoValueMono: {
    fontSize: 14, // text-sm
    lineHeight: 20,
    color: colors.textPrimary,
    fontFamily: MONO_FONT, // font-mono
  },
  emptyState: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  emptyGlyph: {
    fontSize: 32, // h-10 w-10 icon
    lineHeight: 38,
  },
  emptyMessage: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  toastWrap: {
    marginTop: 12,
  },
  toast: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  toastSuccess: {
    borderColor: colors.successBorder,
  },
  toastError: {
    borderColor: colors.dangerBorder,
  },
  toastTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  toastDetail: {
    fontSize: 12,
    lineHeight: 16,
  },
});

export default RegionSettings;
