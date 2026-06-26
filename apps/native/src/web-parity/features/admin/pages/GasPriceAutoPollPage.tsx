// Native parity port of web/src/features/admin/pages/GasPriceAutoPollPage.tsx.
//
// The web module is a thin admin page wrapper that promotes the EIA gas-price
// auto-poll surface (previously an inline /settings#gas-price section) to a
// first-class page: a <PageContainer title subtitle> whose only child is the
// shared <GasPriceSettings /> component
// (web/src/features/settings/components/GasPriceSettings).
//
// Native-safe substitutions (rule 5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('settings') -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (the parity bundle ships no
//     i18n runtime), so every key + copy string is preserved verbatim at the
//     call site, with {{token}} interpolation kept for completeness.
//   • usePageTitle(title) -> a native no-op hook (RN has no document.title); the
//     call site and its translated title key are preserved.
//   • The shared web <PageContainer> -> an inlined native PageContainer that
//     keeps the header (title/subtitle) + loading/error/empty/children branch
//     semantics, wrapped in a ScrollView (matching the BackupRestorePage port).
//   • The shared <GasPriceSettings> sibling component (its own web file, not yet
//     ported) -> an inlined, faithful native GasPriceSettings wired to the
//     already-ported gas-price hooks (useGasPriceStatus / usePollGasPrice /
//     useToggleGasPrice / useUpdateGasPriceConfig) + useSettings() from
//     ../../../api/hooks/useSettings. Every state name, API path, query key,
//     mutation body, and onSuccess toast intent is preserved.
//   • useFormatting().formatCurrency -> an inlined formatCurrency derived from
//     the settings response (currency_symbol + decimal_precision), backed by an
//     inlined fmtNumber (en-US toLocaleString), matching the web helper.
//   • useSettings().settings.gas_unit -> read from the ported useSettings()
//     query data (null-safe), 'liter' -> 'L' else 'gal'.
//   • @/lib/dateFormat formatDateTime -> inlined (en-US, "—" fallback, the same
//     year/month/day/hour/minute options).
//   • useToast().info -> a native Alert.alert bridge (matching the _toastHelpers
//     precedent); only fired from mutation onSuccess (user interaction).
//   • The shared <Button>/<Select>/<HelpIcon>/<SettingField> + the lucide
//     Fuel/Zap/Play/Pause glyphs -> inlined native equivalents (SemanticIcon
//     fuel/bolt/play/pause). HelpIcon resolves empty help text in the no-i18n
//     parity bundle (no call-site defaultValue) and therefore renders nothing,
//     mirroring the web "render nothing when no help content" contract.
//   • All Tailwind className styling -> StyleSheet styles + theme tokens; the
//     neon-green/orange + --text-*/--surface-2/--glass-border intents map to the
//     native token palette.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys). No DOM elements, react-i18next, lucide-react, framer-motion,
// Recharts, Leaflet, react-dom, or web UI-kit modules are imported here.

import React, {
  useCallback,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  useGasPriceStatus,
  usePollGasPrice,
  useToggleGasPrice,
  useUpdateGasPriceConfig,
  useSettings,
} from '../../../api/hooks/useSettings';
import {FadeIn} from '../../../components/motion/FadeIn';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (web react-i18next useTranslation)                   */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number | null | undefined>;
type TOptions = TVars & {defaultValue?: string};
type TFunc = (key: string, arg2?: string | TOptions, arg3?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the `defaultValue`)
// while preserving every key at the call site. The namespace arg is accepted and
// ignored to keep the `useTranslation('settings')` call site verbatim.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, arg2, arg3) => {
    let fallback = key;
    let vars: TVars | undefined;
    if (typeof arg2 === 'string') {
      fallback = arg2;
      vars = arg3;
    } else if (arg2 && typeof arg2 === 'object') {
      const {defaultValue, ...rest} = arg2;
      fallback = defaultValue ?? key;
      vars = rest as TVars;
    }
    return interpolate(fallback, vars);
  }, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ------------------------------------------------------------------ */
/*  useToast (web @/components/feedback/Toast)                         */
/* ------------------------------------------------------------------ */

interface Toast {
  info: (message: string) => void;
}

// Web toast queue -> native Alert.alert (same _toastHelpers precedent). Fired
// only from mutation onSuccess handlers (user interaction), never at render.
function useToast(): Toast {
  return {info: message => Alert.alert(message)};
}

/* ------------------------------------------------------------------ */
/*  Inlined @/lib formatters                                           */
/* ------------------------------------------------------------------ */

// Web @/lib/numberFormat fmtNumber: locale-aware fixed-precision string. en-US
// is used for deterministic output (the BackupRestorePage en-US precedent).
function fmtNumber(value: number, decimals: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return safe.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toFixed(decimals);
  }
}

// Web @/lib/dateFormat formatDateTime: "Apr 4, 2026, 09:05 PM" with a "—"
// fallback for missing / invalid timestamps.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Button                                     */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}

const BUTTON_TONES: Record<ButtonVariant, {bg: string; border: string; text: string}> = {
  primary: {bg: colors.accent, border: colors.accent, text: colors.background},
  ghost: {bg: 'transparent', border: 'transparent', text: colors.textSecondary},
};

function Button({
  variant = 'primary',
  icon,
  loading,
  disabled,
  onClick,
  accessibilityLabel,
  children,
}: ButtonProps) {
  const isDisabled = !!disabled || !!loading;
  const tone = BUTTON_TONES[variant];
  const hasLabel = children != null && children !== false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: isDisabled, busy: !!loading}}
      disabled={isDisabled}
      onPress={onClick}
      style={({pressed}) => [
        styles.btn,
        {backgroundColor: tone.bg, borderColor: tone.border},
        isDisabled ? styles.btnDisabled : null,
        pressed && !isDisabled ? styles.btnPressed : null,
      ]}>
      {loading ? (
        <ActivityIndicator color={tone.text} size="small" />
      ) : icon ? (
        <View style={hasLabel ? styles.btnIconWrap : null}>{icon}</View>
      ) : null}
      {hasLabel ? (
        <AppText style={[styles.btnText, {color: tone.text}]} weight="semibold">
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Select                                     */
/* ------------------------------------------------------------------ */

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

// Web <select> -> a labelled row of pressable option chips (the selected chip is
// accent-tinted). onChange receives the chosen option value, mirroring the web
// `e.target.value` payload.
function Select({label, options, value, onChange}: SelectProps) {
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="muted">
          {label}
        </AppText>
      ) : null}
      <View style={styles.optionRow}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.option,
                active ? styles.optionActive : null,
                pressed ? styles.optionPressed : null,
              ]}>
              <AppText
                style={active ? styles.optionTextActive : styles.optionText}
                weight={active ? 'semibold' : 'regular'}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui HelpIcon + ./SettingField                  */
/* ------------------------------------------------------------------ */

interface HelpIconProps {
  /** i18n key for the help text (preferred over plain `content`). */
  i18nKey?: string;
  /** Default fallback when key is missing or for one-offs. */
  content?: string;
  /** Field id surfaced in the web HelpIcon's aria-label. */
  for?: string;
}

// Web field-level (?) help trigger. In the no-i18n parity bundle the call sites
// supply no defaultValue/content, so the resolved help text is empty and the
// icon renders nothing — exactly matching the web "render nothing when no help
// content" contract. The i18nKey is preserved at the call site.
function HelpIcon({i18nKey, content}: HelpIconProps): React.ReactElement | null {
  const {t} = useTranslation();
  const text = i18nKey ? t(i18nKey, content ?? '') : content ?? '';
  if (!text) {
    return null;
  }
  return (
    <View style={styles.helpIcon}>
      <AppText variant="caption" tone="muted">
        ?
      </AppText>
    </View>
  );
}

interface SettingFieldProps {
  label: string;
  help?: HelpIconProps;
  children: ReactNode;
}

function SettingField({label, help, children}: SettingFieldProps) {
  return (
    <View>
      <View style={styles.settingFieldLabelRow}>
        <AppText style={styles.fieldLabel} tone="muted">
          {label}
        </AppText>
        {help ? (
          <HelpIcon i18nKey={help.i18nKey} content={help.content} for={help.for} />
        ) : null}
      </View>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/layout PageContainer                          */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  empty,
  emptyMessage,
  children,
}: PageContainerProps) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.pageLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : empty ? (
        <View style={styles.pageEmpty}>
          <AppText tone="muted" variant="caption">
            {emptyMessage ?? `No ${title.toLowerCase()} found.`}
          </AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined features/settings/components/GasPriceSettings             */
/* ------------------------------------------------------------------ */

function GasPriceSettings(): React.ReactElement {
  const {t} = useTranslation('settings');
  const {data: settings} = useSettings();
  const gasUnitLabel = settings?.gas_unit === 'liter' ? 'L' : 'gal';
  const toast = useToast();
  const {data: gasPriceStatus} = useGasPriceStatus();
  const gasPollMut = usePollGasPrice();
  const gasToggleMut = useToggleGasPrice();
  const gasConfigMut = useUpdateGasPriceConfig();

  // Inlined useFormatting().formatCurrency: currency symbol + precision derived
  // from the settings response, formatted via fmtNumber (web behaviour).
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const formatCurrency = (amount: number, decimals?: number): string =>
    `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`;

  return (
    <FadeIn delay={0.12}>
      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeaderRow}>
          <SemanticIcon name="fuel" size="md" decorative />
          <View style={styles.panelHeaderText}>
            <AppText style={styles.h2} weight="semibold">
              {t('gas.title', 'Gas Price Auto-Poll')}
            </AppText>
            <AppText style={styles.panelSubtitle} tone="muted">
              {t('gas.subtitle', 'Automatically fetch US average gas prices from EIA')}
            </AppText>
          </View>
        </View>

        <View style={styles.grid2}>
          <View style={styles.cell}>
            <SettingField
              label={t('gas.autoPoll', 'Auto-Poll')}
              help={{
                i18nKey: 'help.fields.settings.gasPriceAutoPoll',
                for: 'gas-auto-poll',
              }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected: !!gasPriceStatus?.enabled}}
                onPress={() => {
                  gasToggleMut.mutate(!gasPriceStatus?.enabled, {
                    onSuccess: () =>
                      toast.info(
                        !gasPriceStatus?.enabled
                          ? t('gas.enabled', 'Auto-poll enabled')
                          : t('gas.disabled', 'Auto-poll disabled'),
                      ),
                  });
                }}
                style={[
                  styles.toggleCard,
                  gasPriceStatus?.enabled
                    ? styles.toggleCardOn
                    : styles.toggleCardOff,
                ]}>
                <SemanticIcon
                  name={gasPriceStatus?.enabled ? 'play' : 'pause'}
                  size="sm"
                  decorative
                />
                <AppText
                  style={[
                    styles.toggleCardText,
                    gasPriceStatus?.enabled
                      ? styles.toggleCardTextOn
                      : styles.toggleCardTextOff,
                  ]}
                  weight="semibold">
                  {gasPriceStatus?.enabled
                    ? t('gas.running', 'Running')
                    : t('gas.stopped', 'Stopped')}
                </AppText>
              </Pressable>
            </SettingField>
          </View>

          <View style={styles.cell}>
            <Select
              label={t('gas.pollInterval', 'Poll Interval')}
              value={gasPriceStatus?.poll_interval || '7d'}
              onChange={value =>
                gasConfigMut.mutate(value, {
                  onSuccess: () =>
                    toast.info(t('gas.intervalUpdated', 'Poll interval updated')),
                })
              }
              options={[
                {value: 'daily', label: t('gas.daily', 'Daily')},
                {value: '7d', label: t('gas.weekly', 'Weekly')},
                {value: '15d', label: t('gas.biweekly', 'Bi-weekly')},
                {value: '30d', label: t('gas.monthly', 'Monthly')},
              ]}
            />
            <View style={styles.helpBelow}>
              <HelpIcon
                i18nKey="help.fields.settings.gasPricePollInterval"
                for="gas-poll-interval"
              />
            </View>
          </View>
        </View>

        <View style={styles.grid2}>
          <View style={styles.cell}>
            <View style={styles.infoCard}>
              <AppText style={styles.infoLabel} tone="muted">
                {t('gas.currentPrice', 'Current Price')}
              </AppText>
              <AppText style={styles.infoValueLg} weight="semibold">
                {gasPriceStatus?.current_price
                  ? `${formatCurrency(gasPriceStatus.current_price)}/${gasUnitLabel}`
                  : '—'}
              </AppText>
            </View>
          </View>
          <View style={styles.cell}>
            <View style={styles.infoCard}>
              <AppText style={styles.infoLabel} tone="muted">
                {t('gas.lastPolled', 'Last Polled')}
              </AppText>
              <AppText style={styles.infoValueSm}>
                {gasPriceStatus?.last_poll_time &&
                gasPriceStatus.last_poll_time !== '0001-01-01T00:00:00Z'
                  ? formatDateTime(gasPriceStatus.last_poll_time)
                  : t('gas.never', 'Never')}
              </AppText>
            </View>
          </View>
        </View>

        <View style={styles.pollRow}>
          <Button
            variant="primary"
            icon={<SemanticIcon name="bolt" size="sm" decorative />}
            onClick={() =>
              gasPollMut.mutate(undefined, {
                onSuccess: () =>
                  toast.info(t('gas.pollTriggered', 'Gas price poll triggered')),
              })
            }
            loading={gasPollMut.isPending}>
            {t('gas.pollNow', 'Poll Now')}
          </Button>
          <AppText style={styles.sourceText} tone="muted">
            {t('gas.source', 'Source: U.S. Energy Information Administration')}
          </AppText>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function GasPriceAutoPollPage(): React.ReactElement {
  const {t} = useTranslation('settings');
  const title = t('gas.title', 'Gas Price Auto-Poll');
  usePageTitle(title);

  return (
    <PageContainer
      title={title}
      subtitle={t(
        'gas.subtitle',
        'Automatically fetch US average gas prices from EIA',
      )}>
      <GasPriceSettings />
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  /* page container */
  page: {backgroundColor: colors.background, flex: 1},
  pageContent: {gap: spacing.lg, padding: spacing.lg},
  pageHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderText: {flex: 1, minWidth: 180},
  pageTitle: {color: colors.textPrimary, fontSize: 24, lineHeight: 30},
  pageSubtitle: {fontSize: 13, lineHeight: 18, marginTop: spacing.xs},
  pageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pageLoading: {alignItems: 'center', justifyContent: 'center', paddingVertical: 80},
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  pageErrorText: {color: colors.danger, fontSize: 13, lineHeight: 18},
  pageEmpty: {alignItems: 'center', justifyContent: 'center', paddingVertical: 64},

  /* panel */
  panel: {padding: spacing.lg, gap: spacing.lg},
  panelHeaderRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.md},
  panelHeaderText: {flex: 1, minWidth: 0},
  h2: {color: colors.textPrimary, fontSize: 16, lineHeight: 22},
  panelSubtitle: {fontSize: 12, lineHeight: 16, marginTop: 2},

  /* two-up grid (grid-cols-1 sm:grid-cols-2) */
  grid2: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  cell: {flexGrow: 1, flexBasis: '46%', minWidth: 150},

  /* field label + help row */
  field: {gap: spacing.xs},
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  settingFieldLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  helpBelow: {marginTop: spacing.xs},
  helpIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 16,
    width: 16,
  },

  /* auto-poll toggle state card */
  toggleCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    width: '100%',
  },
  toggleCardOn: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  toggleCardOff: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  toggleCardText: {fontSize: 14, lineHeight: 20},
  toggleCardTextOn: {color: colors.success},
  toggleCardTextOff: {color: colors.textMuted},

  /* select option chips */
  optionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs},
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  optionActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {opacity: 0.7},
  optionText: {color: colors.textSecondary, fontSize: 13, lineHeight: 18},
  optionTextActive: {color: colors.accent, fontSize: 13, lineHeight: 18},

  /* info cards */
  infoCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    padding: 14,
  },
  infoLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  infoValueLg: {color: colors.textPrimary, fontSize: 18, lineHeight: 24},
  infoValueSm: {color: colors.textPrimary, fontSize: 14, lineHeight: 20},

  /* poll-now row */
  pollRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap'},
  sourceText: {flex: 1, fontSize: 10, lineHeight: 14, minWidth: 120},

  /* button */
  btn: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnIconWrap: {marginRight: 2},
  btnText: {fontSize: 14, lineHeight: 20},
  btnDisabled: {opacity: 0.55},
  btnPressed: {opacity: 0.82},
});
