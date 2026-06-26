// Native parity port of
// web/src/features/settings/components/GasPriceSettings.tsx.
//
// GasPriceSettings is the Settings "Gas Price Auto-Poll" panel: a GlassPanel
// with a fuel-icon header, an Auto-Poll on/off toggle + a poll-interval
// <Select>, two read-only stat cards (current price /{gas unit} and last-polled
// time), and a "Poll Now" primary action plus an EIA data-source footnote. It
// reads /gas-price/status and drives the /gas-price/{toggle,config,poll}
// mutations.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation('settings') (web L1,17) -> a native-safe
//     useTranslation(namespace?) hook (no i18n runtime in RN): t(key, fallback,
//     options?) returns the fallback verbatim (with {{var}} interpolation); the
//     'settings' namespace is accepted + ignored. Every i18n key + English
//     fallback is preserved exactly.
//   - @/api/hooks/useSettings gas-price hooks (web L2-5) ->
//     ../../../api/hooks/useSettings (the already-ported native parity hooks):
//     useGasPriceStatus/usePollGasPrice/useToggleGasPrice/useUpdateGasPriceConfig
//     keep identical API paths + payloads. Those native mutations already emit
//     their own success/error feedback via the parity useMutationToast
//     (Alert.alert); the panel's own toast.info calls are preserved on top
//     (see useToast below), mirroring the web's two-toast flow.
//   - @/hooks/useFormatting formatCurrency (web L6,18) -> an inline native
//     useFormatting shim over the native settings query (currency_symbol +
//     decimal_precision), matching the ChargingListPage precedent. There is no
//     web-parity/hooks port, so the app-level hook is reproduced inline.
//   - @/hooks/useSettings settings.gas_unit (web L7,19-20) -> an inline native
//     useSettings shim over the same native settings query; gas_unit defaults to
//     'gallon' (the web default) so gasUnitLabel resolves to 'gal' before data
//     loads.
//   - @/components/ui GlassPanel/Button/Select/HelpIcon (web L8) -> the native
//     GlassPanel (real ui), the already-ported native parity Select + HelpIcon,
//     and inline Pressable buttons (the web Button's ghost-toggle and
//     primary+icon+loading call shapes have no single native primitive). The DOM
//     <select> onChange(e) -> the native Select onValueChange(value). The
//     i18nKey-only HelpIcons render nothing on native (the ported HelpIcon
//     short-circuits when no i18n runtime supplies help text) — documented in
//     the sidecar.
//   - @/components/motion FadeIn (web L9) -> inline passthrough View; the web
//     framer-motion entrance has no parity-layer RN equivalent, so delay (0.12)
//     is accepted + ignored.
//   - @/components/feedback/Toast useToast (web L10) -> an inline native useToast
//     shim backed by React Native Alert (the parity layer's documented
//     mutationFeedbackPrimitive), preserving the toast.info call sites + strings.
//   - @/lib/cn cn (web L11) -> dropped; the Tailwind class-merge for the toggle's
//     enabled/disabled styling is replaced by RN conditional StyleSheet arrays.
//   - @/lib/dateFormat formatDateTime (web L12) -> an inline native-safe
//     formatDateTime (toLocaleString 'en-US' with the same field options, '—'
//     fallback), matching the DrivesListPage precedent.
//   - ./SettingField (web L13) -> an inline native SettingField (label + optional
//     HelpIcon + children); its standalone native port is owned by its own turn.
//   - lucide-react Fuel/Zap/Play/Pause (web L14) -> decorative text glyphs
//     (fuel/zap/play/pause), rendered via AppText and marked decorative for
//     screen readers (lucide is browser-only SVG).
//   - colours: text-[var(--text-primary)] -> AppText primary tone;
//     text-[var(--text-muted)] -> tone="muted"; --surface-2 ->
//     colors.surfaceRaised; --glass-border -> colors.border; orange-500/400 +
//     neon-green (#10b981 — the enabled-toggle chip exception: same neon on
//     bg/border/text) pinned to their hex. The web `sm:grid-cols-2` grids map to
//     single-column stacks (the grid-cols-1 mobile base) for the phone target.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useMemo} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {HelpIcon} from '../../../components/ui/HelpIcon';
import {Select} from '../../../components/ui/Select';
import {
  useGasPriceStatus,
  usePollGasPrice,
  useSettings as useSettingsQuery,
  useToggleGasPrice,
  useUpdateGasPriceConfig,
} from '../../../api/hooks/useSettings';

// ---- Native-safe i18n fallback (web react-i18next useTranslation, L1) --------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(_namespace?: string): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
  return {t};
}

// ---- Native-safe number/currency formatting (web @/lib/numberFormat) ---------

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ---- useFormatting (web @/hooks/useFormatting, L6) ---------------------------
// Inline shim over the native settings query — there is no web-parity/hooks
// port, so the app-level hook's formatCurrency is reproduced here (the
// ChargingListPage precedent). Only the currency path this panel uses is ported.
function useFormatting(): {
  formatCurrency: (amount: number, decimals?: number) => string;
  currencySymbol: string;
} {
  const {data} = useSettingsQuery();
  const currencySymbol =
    data?.currency_symbol && data.currency_symbol.trim()
      ? data.currency_symbol
      : '$';
  const userPrecision =
    typeof data?.decimal_precision === 'number' &&
    Number.isFinite(data.decimal_precision) &&
    data.decimal_precision >= 0
      ? Math.floor(data.decimal_precision)
      : 2;
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );
  return useMemo(
    () => ({formatCurrency, currencySymbol}),
    [formatCurrency, currencySymbol],
  );
}

// ---- useSettings (web @/hooks/useSettings, L7) -------------------------------
// Only `gas_unit` is consumed here; it defaults to 'gallon' (the web default)
// so the unit label resolves to 'gal' before the settings query resolves.
function useSettings(): {settings: {gas_unit: string}} {
  const {data} = useSettingsQuery();
  const gasUnit = data?.gas_unit ?? 'gallon';
  return useMemo(() => ({settings: {gas_unit: gasUnit}}), [gasUnit]);
}

// ---- useToast (web @/components/feedback/Toast, L10) -------------------------
// No native Toast provider exists; the parity layer's documented feedback
// primitive is React Native Alert. The web `toast.info(title)` contract is
// preserved (success/error/warning kept for shape parity, though only info is
// used here).
type ToastFn = (title: string, message?: string) => void;
function useToast(): {
  info: ToastFn;
  success: ToastFn;
  error: ToastFn;
  warning: ToastFn;
} {
  return useMemo(() => {
    const show: ToastFn = (title, message) => Alert.alert(title, message);
    return {info: show, success: show, error: show, warning: show};
  }, []);
}

// ---- formatDateTime (web @/lib/dateFormat, L12) -----------------------------
const DATE_FALLBACK = '—';
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return DATE_FALLBACK;
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return DATE_FALLBACK;
  }
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---- SettingField (web ./SettingField, L13) ---------------------------------
interface SettingFieldHelp {
  /** i18n key for the inline `<HelpIcon>`. */
  i18nKey?: string;
  /** Plain-text fallback when the i18n key is missing. */
  content?: string;
  /** Field id surfaced in the HelpIcon's accessibility label. */
  for?: string;
}

function SettingField({
  label,
  help,
  children,
}: {
  label: string;
  help?: SettingFieldHelp;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View>
      <View style={styles.fieldLabelRow}>
        <AppText style={styles.fieldLabel} tone="muted">
          {label}
        </AppText>
        {help ? (
          <HelpIcon
            content={help.content}
            for={help.for}
            i18nKey={help.i18nKey}
          />
        ) : null}
      </View>
      {children}
    </View>
  );
}

// ---- FadeIn (web @/components/motion FadeIn, L9) — no RN entrance animation --

function FadeIn({
  children,
}: {
  children: React.ReactNode;
  /** Web framer-motion entrance delay — accepted and ignored on native. */
  delay?: number;
}): React.ReactElement {
  return <View>{children}</View>;
}

// ---- lucide-react glyphs (web L14) ------------------------------------------
const FUEL_GLYPH = '⛽'; // Fuel
const ZAP_GLYPH = '⚡'; // Zap
const PLAY_GLYPH = '▶'; // Play (running)
const PAUSE_GLYPH = '⏸'; // Pause (stopped)

// Tailwind palette colors pinned to hex (not CSS vars). orange-400 is the
// header glyph; neon-green (#10b981) is the enabled-toggle chip exception.
const ORANGE_400 = '#fb923c';
const NEON_GREEN = '#10b981';

/**
 * "Gas Price Auto-Poll" settings panel (native parity). Web L16-116.
 */
export function GasPriceSettings(): React.ReactElement {
  const {t} = useTranslation('settings');
  const {formatCurrency} = useFormatting();
  const {settings} = useSettings();
  const gasUnitLabel = settings.gas_unit === 'liter' ? 'L' : 'gal';
  const toast = useToast();
  const {data: gasPriceStatus} = useGasPriceStatus();
  const gasPollMut = usePollGasPrice();
  const gasToggleMut = useToggleGasPrice();
  const gasConfigMut = useUpdateGasPriceConfig();

  // Mirrors the web `gasPriceStatus?.enabled` read used across the toggle.
  const enabled = gasPriceStatus?.enabled ?? false;
  const lastPolled =
    gasPriceStatus?.last_poll_time &&
    gasPriceStatus.last_poll_time !== '0001-01-01T00:00:00Z'
      ? formatDateTime(gasPriceStatus.last_poll_time)
      : t('gas.never', 'Never');

  return (
    <FadeIn delay={0.12}>
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.headerIconGlyph}>
              {FUEL_GLYPH}
            </AppText>
          </View>
          <View style={styles.headerText}>
            <AppText style={styles.headerTitle} weight="semibold">
              {t('gas.title', 'Gas Price Auto-Poll')}
            </AppText>
            <AppText style={styles.headerSubtitle} tone="muted">
              {t(
                'gas.subtitle',
                'Automatically fetch US average gas prices from EIA',
              )}
            </AppText>
          </View>
        </View>

        <View style={styles.grid}>
          <SettingField
            help={{
              i18nKey: 'help.fields.settings.gasPriceAutoPoll',
              for: 'gas-auto-poll',
            }}
            label={t('gas.autoPoll', 'Auto-Poll')}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{selected: enabled}}
              onPress={() => {
                gasToggleMut.mutate(!enabled, {
                  onSuccess: () =>
                    toast.info(
                      !enabled
                        ? t('gas.enabled', 'Auto-poll enabled')
                        : t('gas.disabled', 'Auto-poll disabled'),
                    ),
                });
              }}
              style={[styles.toggle, enabled ? styles.toggleOn : styles.toggleOff]}>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.toggleGlyph,
                  enabled ? styles.toggleTextOn : styles.toggleTextOff,
                ]}>
                {enabled ? PLAY_GLYPH : PAUSE_GLYPH}
              </AppText>
              <AppText
                style={[
                  styles.toggleLabel,
                  enabled ? styles.toggleTextOn : styles.toggleTextOff,
                ]}>
                {enabled
                  ? t('gas.running', 'Running')
                  : t('gas.stopped', 'Stopped')}
              </AppText>
            </Pressable>
          </SettingField>

          <View>
            <Select
              label={t('gas.pollInterval', 'Poll Interval')}
              onValueChange={value =>
                gasConfigMut.mutate(value, {
                  onSuccess: () =>
                    toast.info(
                      t('gas.intervalUpdated', 'Poll interval updated'),
                    ),
                })
              }
              options={[
                {value: 'daily', label: t('gas.daily', 'Daily')},
                {value: '7d', label: t('gas.weekly', 'Weekly')},
                {value: '15d', label: t('gas.biweekly', 'Bi-weekly')},
                {value: '30d', label: t('gas.monthly', 'Monthly')},
              ]}
              value={gasPriceStatus?.poll_interval || '7d'}
            />
            <View style={styles.helpRow}>
              <HelpIcon
                for="gas-poll-interval"
                i18nKey="help.fields.settings.gasPricePollInterval"
              />
            </View>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.statCard}>
            <AppText style={styles.statLabel} tone="muted">
              {t('gas.currentPrice', 'Current Price')}
            </AppText>
            <AppText style={styles.statValueLg} weight="semibold">
              {gasPriceStatus?.current_price
                ? `${formatCurrency(gasPriceStatus.current_price)}/${gasUnitLabel}`
                : '—'}
            </AppText>
          </View>
          <View style={styles.statCard}>
            <AppText style={styles.statLabel} tone="muted">
              {t('gas.lastPolled', 'Last Polled')}
            </AppText>
            <AppText style={styles.statValueSm}>{lastPolled}</AppText>
          </View>
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: gasPollMut.isPending}}
            disabled={gasPollMut.isPending}
            onPress={() =>
              gasPollMut.mutate(undefined, {
                onSuccess: () =>
                  toast.info(t('gas.pollTriggered', 'Gas price poll triggered')),
              })
            }
            style={({pressed}) => [
              styles.pollButton,
              pressed && !gasPollMut.isPending && styles.pollButtonPressed,
              gasPollMut.isPending && styles.pollButtonDisabled,
            ]}>
            {gasPollMut.isPending ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.pollButtonGlyph}>
                {ZAP_GLYPH}
              </AppText>
            )}
            <AppText style={styles.pollButtonLabel} weight="semibold">
              {t('gas.pollNow', 'Poll Now')}
            </AppText>
          </Pressable>
          <AppText style={styles.sourceText} tone="muted">
            {t('gas.source', 'Source: U.S. Energy Information Administration')}
          </AppText>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

GasPriceSettings.displayName = 'GasPriceSettings';

const styles = StyleSheet.create({
  // web GlassPanel `p-6 space-y-5` (L29): padding 24 + 20px vertical gap.
  panel: {
    gap: 20,
    padding: 24,
  },
  // web header `flex items-center gap-3` (L30).
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  // web header icon `h-10 w-10 rounded-xl bg-orange-500/10 ring-1
  // ring-orange-500/20` (L31): 40x40, rounded 12, orange-500 #f97316 alpha
  // 0.1 bg + 0.2 ring.
  headerIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
    borderColor: 'rgba(249, 115, 22, 0.2)',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  // web Fuel `h-5 w-5 text-orange-400` (L32).
  headerIconGlyph: {
    color: ORANGE_400,
    fontSize: 18,
    lineHeight: 22,
  },
  // web header text `<div>` — flex 1 so the title/subtitle wrap beside the icon.
  headerText: {
    flex: 1,
  },
  // web h2 `text-base font-semibold text-[var(--text-primary)]` (L35).
  headerTitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  // web p `text-xs text-[var(--text-muted)]` (L36).
  headerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web `grid grid-cols-1 sm:grid-cols-2 gap-4` (L40, L88): grid-cols-1 base ->
  // single-column stack with a 16px gap for the phone target.
  grid: {
    gap: 16,
  },
  // web SettingField label row `mb-1.5 flex items-center gap-1` (L25 src).
  fieldLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  // web label `text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]`.
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  // web toggle Button `flex items-center gap-3 w-full rounded-xl border p-3.5`
  // (L55-56).
  toggle: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    width: '100%',
  },
  // web enabled `border-neon-green/40 bg-neon-green/5` (L58): neon-green #10b981.
  toggleOn: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  // web disabled `border-[var(--glass-border)] bg-[var(--surface-2)]` (L59).
  toggleOff: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  // web Play/Pause `h-4 w-4` (L62).
  toggleGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  // web span `text-sm font-medium` (L63).
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  // web enabled `text-neon-green` (L58).
  toggleTextOn: {
    color: NEON_GREEN,
  },
  // web disabled `text-[var(--text-muted)]` (L59).
  toggleTextOff: {
    color: colors.textMuted,
  },
  // web `mt-1` HelpIcon wrapper (L79).
  helpRow: {
    marginTop: 4,
  },
  // web stat card `rounded-xl border border-[var(--glass-border)]
  // bg-[var(--surface-2)] p-3.5` (L89, L95).
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  // web stat label `text-xs font-medium uppercase tracking-wider mb-1
  // text-[var(--text-muted)]` (L90, L96).
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    lineHeight: 16,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  // web current price `text-lg font-semibold text-[var(--text-primary)]` (L91).
  statValueLg: {
    fontSize: 18,
    lineHeight: 24,
  },
  // web last polled `text-sm text-[var(--text-primary)]` (L97).
  statValueSm: {
    fontSize: 14,
    lineHeight: 20,
  },
  // web footer `flex items-center gap-4` (L105).
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  // web primary Button (L106) -> native primary: accent bg, dark label/icon.
  pollButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  pollButtonPressed: {
    opacity: 0.82,
  },
  pollButtonDisabled: {
    opacity: 0.6,
  },
  // web Zap `h-4 w-4` (L106), inherits the dark primary-button text color.
  pollButtonGlyph: {
    color: colors.background,
    fontSize: 14,
    lineHeight: 18,
  },
  pollButtonLabel: {
    color: colors.background,
    fontSize: 14,
    lineHeight: 18,
  },
  // web source `text-[10px] text-[var(--text-muted)]` (L109): flex 1 to wrap.
  sourceText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
  },
});
