// Native parity port of
// web/src/features/charging/components/charging-list/SessionListSection.tsx.
//
// Preserves the full charging-list section: the loading skeleton stack, the
// "no sessions yet" empty state, the debounced search bar + active-filter
// chips, the All-Sessions header with the live `(filteredSessions.length)`
// count, the charger-filter pill group (All/Home/SC/DC), the sort pill group
// (Date/kWh/Cost/Time/Power) with the active ↑/↓ indicator and the
// "same key toggles, new key switches" handleSortClick rule, the CSV/JSON
// export affordances (with the exact `/api/v1/export/charging?...` query
// string), the "no matches" empty state, the bulk-actions toolbar (delete with
// a {{count}}/{{noun}} confirm), the staggered session-card list, and the
// pagination footer with its `filteredSessions.length < pageSize` total math.
// All prop/state names, i18n keys + English fallbacks, snake_case API params,
// and the SI-Wh/-W unit handling are kept verbatim.
//
// Native adaptations vs. the web source (behaviour / keys / units kept):
//   - react-i18next useTranslation (web L1) -> native-safe t(key, fallback,
//     options?) with {{var}} interpolation (no localStorage/i18n runtime here).
//   - lucide-react glyph icons (web L3: BatteryCharging/Filter/ArrowUpDown/
//     Download/Trash2) -> SemanticIcon glyphs rendered through AppText, or the
//     toned section/empty iconography; all decorative for a11y.
//   - @/components/ui Button + Pagination (web L4) -> inline native PillButton /
//     ExportButton / Pagination built on Pressable (no DOM <button>/<select>);
//     Pagination keeps the showing/perPage/first/previous/next/last keys.
//   - @/components/data-display BulkActionsToolbar + BulkAction (web L5) -> the
//     converted parity sibling (../../../../components/data-display/
//     BulkActionsToolbar); the Trash2 ReactNode icon becomes the 'delete' glyph.
//   - @/components/motion FadeIn/StaggerContainer/StaggerItem (web L6) -> an
//     inline reduced-motion-aware FadeIn + the converted StaggerContainer
//     parity sibling; StaggerItem collapses into the container's per-child
//     stagger so each card is passed directly as a keyed child.
//   - @/components/feedback Skeleton/EmptyState (web L7) -> inline
//     reduced-motion-aware SkeletonRow bars + a ChargingEmptyState that pairs
//     the shared native EmptyState with the batteryCharging glyph.
//   - @/components/forms SearchInput/FilterBar/ActiveFilterChips (web L8) ->
//     inline native SearchInput (controlled + 250ms debounce + clear; the
//     localStorage recent-searches dropdown is unavailable on native and is
//     omitted, historyScope retained for API parity) + inline FilterBar +
//     the converted ActiveFilterChips parity sibling.
//   - @/lib/cn cn (web L9) -> dropped; React Native uses StyleSheet.
//   - @/api/types ChargingSession (web L10) -> the web-parity api/types mirror.
//   - ../ChargingSessionCard (web L11) -> an inline native ChargingSessionCard
//     (the sibling card has not been converted yet); it ports getChargerCategory,
//     the chargingAggregation duration/avgPower/costPerKwh helpers, distanceAddedM,
//     and the battery-friendly sessionScore, and renders the timestamp, duration,
//     charger/energy/free badges, route line, and metric chips. The web detail
//     href (/charging/{id}) has no router in this parity tree, so row press is
//     wired to selection when a toggle handler is supplied.
//   - ./helpers SortKey/ChargerFilter (web L12) -> inline-ported union types
//     (the sibling helpers.ts has not been converted yet).
//   - the web <a href download> export anchors -> Linking.openURL on the
//     apiUrl()-resolved absolute URL (no Content-Disposition download attr on
//     native; the filename stays server-controlled).
// See the .parity.json sidecar for the line-by-line source map.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {apiUrl} from '../../../../../api/client';
import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {ChargingSession} from '../../../../api/types';
import {
  BulkActionsToolbar,
  type BulkAction,
} from '../../../../components/data-display/BulkActionsToolbar';
import {
  ActiveFilterChips,
  type FilterChipDescriptor,
} from '../../../../components/forms/ActiveFilterChips';
import {StaggerContainer} from '../../../../components/motion/StaggerContainer';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = options[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

// ---- Native-safe number / currency / date / duration formatting -------------
// Ported from web/src/lib/numberFormat.ts (fmtNumber/fmtInt/fmtWithUnit),
// the useFormatting().formatCurrency contract, and web/src/lib/dateFormat.ts
// (formatDateShort/formatDurationMinutes). This parity tree has no settings
// wiring, so the web no-settings defaults are used directly: precision 2,
// locale en-US, currency symbol '$'.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;
const DEFAULT_CURRENCY_SYMBOL = '$';
const DATE_FALLBACK = '—';
const DURATION_FALLBACK = '—';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

function fmtWithUnit(value: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(value, decimals)} ${unit}`;
}

function formatCurrency(amount: number, decimals = DEFAULT_PRECISION): string {
  return `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`;
}

function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) {
    return DATE_FALLBACK;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return DATE_FALLBACK;
  }
  try {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatDurationMinutes(minutes: number | null | undefined): string {
  if (!isFiniteNumber(minutes) || minutes < 0) {
    return DURATION_FALLBACK;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// ---- Charger + session helpers (ported from web/src/lib/chargingAggregation.ts
//      and web/src/features/charging/components/charging-curve/helpers.ts) -----

type ChargerCategory = 'home' | 'supercharger' | 'dc' | 'unknown';

function getChargerCategory(type: string | null | undefined): ChargerCategory {
  if (!type) {
    return 'home';
  }
  const normalized = type.toLowerCase();
  if (normalized.includes('super') || normalized.includes('tpc')) {
    return 'supercharger';
  }
  if (
    normalized.includes('dc') ||
    normalized.includes('ccs') ||
    normalized.includes('chademo') ||
    normalized.includes('fast')
  ) {
    return 'dc';
  }
  if (
    normalized.includes('home') ||
    normalized.includes('ac') ||
    normalized.includes('wall')
  ) {
    return 'home';
  }
  return 'unknown';
}

function sessionDurationMinutes(session: ChargingSession): number {
  if (!session.started_at || !session.ended_at) {
    return 0;
  }
  const start = Date.parse(session.started_at);
  const end = Date.parse(session.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return (end - start) / 60_000;
}

function avgPowerW(session: ChargingSession): number {
  const minutes = sessionDurationMinutes(session);
  if (minutes > 0 && session.total_energy_added_wh > 0) {
    return session.total_energy_added_wh / (minutes / 60);
  }
  return session.avg_power_w ?? 0;
}

function costPerKwh(session: ChargingSession): number | null {
  if (session.total_energy_added_wh <= 0) {
    return null;
  }
  if (session.cost_decimal == null || session.cost_decimal <= 0) {
    return null;
  }
  return session.cost_decimal / (session.total_energy_added_wh / 1000);
}

function distanceAddedM(session: ChargingSession): number | null {
  if (session.start_odometer_m == null || session.end_odometer_m == null) {
    return null;
  }
  const delta = session.end_odometer_m - session.start_odometer_m;
  return delta > 0 ? delta : null;
}

function batteryFriendlyScore(
  startPct: number | null | undefined,
  endPct: number | null | undefined,
): number | null {
  if (startPct == null || endPct == null) {
    return null;
  }
  let score = 50;
  if (startPct <= 30) {
    score += 30;
  } else if (startPct <= 50) {
    score += 15;
  } else if (startPct <= 70) {
    score += 0;
  } else {
    score -= 10;
  }
  if (endPct <= 80) {
    score += 20;
  } else if (endPct <= 90) {
    score += 0;
  } else if (endPct < 100) {
    score -= 10;
  } else {
    score -= 25;
  }
  return Math.max(0, Math.min(100, score));
}

// ---- Sort / filter types (ported from ./helpers — sibling not converted) ----

type SortKey = 'date' | 'energy' | 'cost' | 'duration' | 'power';
type ChargerFilter = 'all' | 'supercharger' | 'dc' | 'home';

// ---- Reduced-motion awareness (web prefers-reduced-motion) ------------------

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// ---- Inline FadeIn (web @/components/motion FadeIn — framer-motion) ----------
// Reproduces the web {opacity:0, y:10} -> {opacity:1, y:0} ease-out entrance
// with the per-call delay (web delay 0.2 / 0.22s); reduced motion collapses to
// the final state immediately (the web no-op).

const FADE_IN_DURATION_MS = 320;
const FADE_IN_TRANSLATE_Y = 10;

function FadeIn({
  children,
  delaySeconds = 0,
  style,
}: {
  children: ReactNode;
  delaySeconds?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delaySeconds * 1000,
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delaySeconds, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [FADE_IN_TRANSLATE_Y, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

// ---- Inline Skeleton (web @/components/feedback Skeleton, className="h-20") ---

const SKELETON_COLOR = '#374151';
const SKELETON_HEIGHT = 80;
const PULSE_DURATION_MS = 1000;
const OPACITY_BRIGHT = 1;
const OPACITY_DIM = 0.5;
const REDUCED_MOTION_OPACITY = 0.75;

function SkeletonRow({
  reduceMotion,
}: {
  reduceMotion: boolean;
}): React.ReactElement {
  const pulse = useRef(new Animated.Value(OPACITY_BRIGHT)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(REDUCED_MOTION_OPACITY);
      return;
    }

    pulse.setValue(OPACITY_BRIGHT);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: OPACITY_DIM,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          toValue: OPACITY_BRIGHT,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.skeletonRow, {opacity: pulse}]}
    />
  );
}

// ---- Inline EmptyState with icon (web @/components/feedback EmptyState) ------
// The shared native EmptyState exposes only title/message, so the
// batteryCharging glyph is paired above it to preserve the web icon intent.

const BATTERY_CHARGING_GLYPH = getSemanticIconDefinition('batteryCharging').glyph;
const SEARCH_GLYPH = getSemanticIconDefinition('search').glyph;
const CLEAR_GLYPH = getSemanticIconDefinition('close').glyph;
const FILTER_GLYPH = getSemanticIconDefinition('filter').glyph;
const SORT_GLYPH = getSemanticIconDefinition('arrowUpDown').glyph;
const DOWNLOAD_GLYPH = getSemanticIconDefinition('download').glyph;
const DELETE_GLYPH = getSemanticIconDefinition('delete').glyph;
const CHECK_GLYPH = getSemanticIconDefinition('confirm').glyph;
const FIRST_GLYPH = '«';
const PREV_GLYPH = '‹';
const NEXT_GLYPH = '›';
const LAST_GLYPH = '»';

function ChargingEmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.emptyGlyph}
        weight="bold">
        {BATTERY_CHARGING_GLYPH}
      </AppText>
      <EmptyState title={title} message={message} />
    </View>
  );
}

// ---- Inline SearchInput (web @/components/forms SearchInput) -----------------
// Controlled value + 250ms debounce + clear button + leading search glyph. The
// localStorage recent-searches dropdown (web historyScope) has no native
// localStorage and is omitted; the prop is retained for API parity.

const SEARCH_DEBOUNCE_MS = 250;

function SearchInput({
  value,
  onChange,
  placeholder,
  clearLabel,
  debounceMs = SEARCH_DEBOUNCE_MS,
  historyScope: _historyScope,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel: string;
  debounceMs?: number;
  historyScope?: string;
}): React.ReactElement {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local === value) {
      return;
    }
    const id = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(id);
  }, [local, value, debounceMs, onChange]);

  const handleClear = useCallback(() => {
    setLocal('');
    onChange('');
  }, [onChange]);

  return (
    <View style={styles.searchRoot}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.searchGlyph}
        tone="muted"
        weight="bold">
        {SEARCH_GLYPH}
      </AppText>
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onBlur={() => setFocused(false)}
        onChangeText={setLocal}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        selectionColor={colors.accent}
        style={[styles.searchInput, focused && styles.searchInputFocused]}
        value={local}
      />
      {local ? (
        <Pressable
          accessibilityLabel={clearLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleClear}
          style={({pressed}) => [
            styles.searchClear,
            pressed && styles.pressed,
          ]}>
          <AppText style={styles.searchClearGlyph} tone="muted" weight="bold">
            {CLEAR_GLYPH}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Inline FilterBar (web @/components/forms FilterBar) ---------------------

function FilterBar({children}: {children: ReactNode}): React.ReactElement {
  return <View style={styles.filterBar}>{children}</View>;
}

// ---- Inline PillButton (web @/components/ui Button, ghost/sm + active state) -

function PillButton({
  label,
  active,
  onPress,
  indicator,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  indicator?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.pill,
        active && styles.pillActive,
        pressed && styles.pressed,
      ]}>
      <AppText
        numberOfLines={1}
        style={[styles.pillText, active && styles.pillTextActive]}
        weight="semibold">
        {label}
        {indicator ? `${' '}${indicator}` : ''}
      </AppText>
    </Pressable>
  );
}

// ---- Inline ExportButton (web @/components/ui Button secondary + <a download>)

function ExportButton({
  label,
  href,
}: {
  label: string;
  href: string;
}): React.ReactElement {
  const handlePress = useCallback(() => {
    void Linking.openURL(apiUrl(href)).catch(() => undefined);
  }, [href]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={handlePress}
      style={({pressed}) => [styles.exportButton, pressed && styles.pressed]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.exportGlyph}
        tone="secondary"
        weight="bold">
        {DOWNLOAD_GLYPH}
      </AppText>
      <AppText style={styles.exportLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---- Inline selection Checkbox (web @/components/ui/Checkbox) ----------------

function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  label: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      hitSlop={8}
      onPress={() => onToggle(!checked)}
      style={({pressed}) => [
        styles.checkbox,
        checked && styles.checkboxChecked,
        pressed && styles.pressed,
      ]}>
      {checked ? (
        <AppText style={styles.checkboxGlyph} weight="bold">
          {CHECK_GLYPH}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ---- Inline Badge (web @/components/ui Badge) --------------------------------

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info';

function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant: BadgeVariant;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, badgeTextVariantStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ---- Inline ScoreBadge (web @/components/data-display ScoreBadge) ------------

function ScoreBadge({
  score,
  label,
}: {
  score: number;
  label: string;
}): React.ReactElement {
  return (
    <View accessibilityLabel={label} style={styles.scoreBadge}>
      <AppText style={styles.scoreBadgeText} variant="caption" weight="bold">
        {fmtInt(score)}
      </AppText>
    </View>
  );
}

// ---- Inline ChargingSessionCard (web ../ChargingSessionCard) -----------------
// Sibling card not converted yet; this native card ports the web display chain
// (timestamp, duration, charger/energy/free badges, route line, metric chips)
// and the battery-friendly score, using the available web-parity ChargingSession
// fields and the toDistanceDisplay/distanceUnit props for the distance-gained
// metric. The web detail href has no native router, so row press toggles
// selection when an onToggleSelect handler is supplied.

const CHARGER_BADGE_VARIANT: Record<ChargerCategory, BadgeVariant> = {
  home: 'success',
  supercharger: 'danger',
  dc: 'warning',
  unknown: 'success',
};

function ChargingSessionCard({
  session,
  toDistanceDisplay,
  distanceUnit,
  selected,
  onToggleSelect,
  t,
}: {
  session: ChargingSession;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
  selected: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
  t: NativeTFunction;
}): React.ReactElement {
  const cat = getChargerCategory(session.charger_type);
  const chargerLabels: Record<ChargerCategory, string> = {
    supercharger: t('chargerTypes.supercharger', 'Supercharger'),
    dc: t('chargerTypes.dc', 'DC Fast'),
    home: t('chargerTypes.home', 'Home / AC'),
    unknown: t('chargerTypes.unknown', 'Charger'),
  };

  const durationMin = sessionDurationMinutes(session);
  const rawAvgPowerW = avgPowerW(session);
  const avgRateKw = rawAvgPowerW > 0 ? rawAvgPowerW / 1000 : null;
  const cpk = costPerKwh(session);
  const addedM = distanceAddedM(session);
  const milesGained = addedM != null ? toDistanceDisplay(addedM / 1000) : null;
  const energyKwh = (session.total_energy_added_wh ?? 0) / 1000;
  const isFree = session.cost_decimal == null || session.cost_decimal === 0;
  const sessionScore = batteryFriendlyScore(
    session.start_soc_pct,
    session.end_soc_pct,
  );
  const showCheckbox = typeof onToggleSelect === 'function';

  const handlePress = useCallback(() => {
    onToggleSelect?.(session.id, !selected);
  }, [onToggleSelect, selected, session.id]);

  return (
    <Pressable
      accessibilityRole={showCheckbox ? 'checkbox' : undefined}
      accessibilityState={showCheckbox ? {checked: selected} : undefined}
      disabled={!showCheckbox}
      onPress={showCheckbox ? handlePress : undefined}
      style={({pressed}) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && showCheckbox && styles.pressed,
      ]}>
      <View style={styles.cardHeader}>
        {showCheckbox ? (
          <Checkbox
            checked={selected}
            label={t('selectSession', 'Select charging session')}
            onToggle={next => onToggleSelect?.(session.id, next)}
          />
        ) : null}
        {sessionScore != null ? (
          <ScoreBadge
            label={t('scoreAria', 'Battery-friendly score: {{value}}', {
              value: sessionScore,
            })}
            score={sessionScore}
          />
        ) : null}
        <View style={styles.cardHeaderText}>
          <AppText numberOfLines={1} weight="semibold">
            {formatDateTimeShort(session.started_at)}
          </AppText>
          <AppText tone="muted" variant="caption">
            {formatDurationMinutes(durationMin)}
          </AppText>
        </View>
      </View>

      <View style={styles.cardBadges}>
        <Badge variant={CHARGER_BADGE_VARIANT[cat]}>{chargerLabels[cat]}</Badge>
        {energyKwh > 0 ? (
          <Badge variant="info">{fmtWithUnit(energyKwh, 'kWh')}</Badge>
        ) : null}
        {isFree && energyKwh > 0 ? (
          <Badge variant="success">{t('free', 'Free')}</Badge>
        ) : null}
      </View>

      {session.start_place ? (
        <AppText numberOfLines={1} tone="secondary" variant="caption">
          {`📍 ${session.start_place}`}
        </AppText>
      ) : null}

      <View style={styles.metricsRow}>
        {session.start_soc_pct != null && session.end_soc_pct != null ? (
          <AppText style={styles.metricText} variant="caption">
            {`${fmtInt(session.start_soc_pct)}% → ${fmtInt(
              session.end_soc_pct,
            )}%`}
          </AppText>
        ) : null}
        {session.peak_power_w != null ? (
          <AppText style={styles.metricText} variant="caption">
            {`${fmtNumber(session.peak_power_w / 1000)} kW peak`}
          </AppText>
        ) : null}
        {avgRateKw != null ? (
          <AppText style={styles.metricText} variant="caption">
            {`~${fmtNumber(avgRateKw)} kW avg`}
          </AppText>
        ) : null}
        {durationMin > 0 ? (
          <AppText style={styles.metricText} variant="caption">
            {formatDurationMinutes(durationMin)}
          </AppText>
        ) : null}
        {typeof session.cost_decimal === 'number' && session.cost_decimal > 0 ? (
          <AppText style={styles.metricCost} variant="caption" weight="semibold">
            {formatCurrency(session.cost_decimal)}
          </AppText>
        ) : null}
        {cpk != null ? (
          <AppText style={styles.metricText} tone="muted" variant="caption">
            {`(${formatCurrency(cpk, 2)}/kWh)`}
          </AppText>
        ) : null}
        {typeof milesGained === 'number' && milesGained > 0 ? (
          <AppText style={styles.metricDistance} variant="caption" weight="semibold">
            {`+${fmtInt(milesGained)} ${distanceUnit}`}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---- Inline Pagination (web @/components/ui Pagination) ----------------------

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  t,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  t: NativeTFunction;
}): React.ReactElement {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <View
      accessibilityLabel={t('a11y.pagination', 'Pagination')}
      style={styles.pagination}>
      <View style={styles.paginationInfo}>
        <AppText accessibilityLiveRegion="polite" tone="muted" variant="caption">
          {t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}', {
            start: total > 0 ? start : 0,
            end,
            total,
          })}
        </AppText>
        <View style={styles.pageSizeGroup}>
          {PAGE_SIZE_OPTIONS.map(size => (
            <PillButton
              active={pageSize === size}
              key={size}
              label={t('pagination.perPage', '{{count}} / page', {count: size})}
              onPress={() => onPageSizeChange(size)}
            />
          ))}
        </View>
      </View>

      <View style={styles.pageNavRow}>
        <NavButton
          glyph={FIRST_GLYPH}
          label={t('pagination.first', 'First page')}
          disabled={page <= 1}
          onPress={() => onPageChange(1)}
        />
        <NavButton
          glyph={PREV_GLYPH}
          label={t('pagination.previous', 'Previous page')}
          disabled={page <= 1}
          onPress={() => onPageChange(page - 1)}
        />
        <AppText
          accessibilityLabel={t(
            'pagination.currentPage',
            'Page {{page}} of {{total}}',
            {page, total: totalPages},
          )}
          style={styles.pageLabel}
          tone="secondary"
          variant="caption"
          weight="semibold">
          {`${page} / ${totalPages}`}
        </AppText>
        <NavButton
          glyph={NEXT_GLYPH}
          label={t('pagination.next', 'Next page')}
          disabled={page >= totalPages}
          onPress={() => onPageChange(page + 1)}
        />
        <NavButton
          glyph={LAST_GLYPH}
          label={t('pagination.last', 'Last page')}
          disabled={page >= totalPages}
          onPress={() => onPageChange(totalPages)}
        />
      </View>
    </View>
  );
}

function NavButton({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.navButton,
        disabled && styles.navButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText style={styles.navGlyph} tone="muted" weight="bold">
        {glyph}
      </AppText>
    </Pressable>
  );
}

// ---- Props (web SessionListSectionProps L14-40) -----------------------------

interface SessionListSectionProps {
  sessions: ChargingSession[] | undefined;
  filteredSessions: ChargingSession[];
  isLoading: boolean;
  toDistanceDisplay: (mi: number) => number;
  distanceUnit: string;
  sortBy: SortKey;
  sortDesc: boolean;
  chargerFilter: ChargerFilter;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSortChange: (key: SortKey) => void;
  onSortToggle: () => void;
  onChargerFilterChange: (filter: ChargerFilter) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  startDate: string;
  endDate: string;
  vehicleId: number | null;
  // Bulk-action plumbing
  selectedIds?: Set<number>;
  onToggleSelected?: (id: number, on: boolean) => void;
  onClearSelection?: () => void;
  onBulkDelete?: (ids: number[]) => Promise<void>;
}

export function SessionListSection({
  sessions,
  filteredSessions,
  isLoading,
  toDistanceDisplay,
  distanceUnit,
  sortBy,
  sortDesc,
  chargerFilter,
  searchQuery,
  onSearchQueryChange,
  onSortChange,
  onSortToggle,
  onChargerFilterChange,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  startDate,
  endDate,
  vehicleId,
  selectedIds,
  onToggleSelected,
  onClearSelection,
  onBulkDelete,
}: SessionListSectionProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!onBulkDelete) {
      return [];
    }
    const count = selectedIds?.size ?? 0;
    return [
      {
        id: 'delete',
        label: t('bulk.actions.delete', 'Delete'),
        icon: DELETE_GLYPH,
        variant: 'danger',
        confirm: {
          title: t('bulk.deleteConfirmTitle', 'Delete {{count}} {{noun}}?', {
            count,
            noun:
              count === 1
                ? t('bulk.noun.session_one', 'charging session')
                : t('bulk.noun.session_other', 'charging sessions'),
          }),
          description: t('bulk.deleteConfirmDescription', 'This cannot be undone.'),
          confirmLabel: t('common.delete', 'Delete'),
        },
        onClick: async ids => {
          await onBulkDelete(ids.map(Number));
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, selectedIds?.size, onBulkDelete]);

  if (isLoading) {
    return (
      <View style={styles.loadingStack}>
        {[1, 2, 3, 4, 5].map(i => (
          <SkeletonRow key={i} reduceMotion={reduceMotion} />
        ))}
      </View>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <ChargingEmptyState
        title={t('charging.list.empty', 'No charging sessions yet')}
        message={t(
          'charging.list.emptyDescription',
          'Charging data will appear here once your vehicle records a session.',
        )}
      />
    );
  }

  const handleSortClick = (key: SortKey) => {
    if (sortBy === key) {
      onSortToggle();
    } else {
      onSortChange(key);
    }
  };

  const chargerFilterOptions = [
    {key: 'all' as const, label: t('charging.sessions.filterAll', 'All')},
    {key: 'home' as const, label: t('charging.sessions.filterHome', 'Home')},
    {key: 'supercharger' as const, label: t('charging.sessions.filterSC', 'SC')},
    {key: 'dc' as const, label: t('charging.sessions.filterDC', 'DC')},
  ];

  const sortOptions = [
    {key: 'date' as const, label: t('charging.sessions.sortDate', 'Date')},
    {key: 'energy' as const, label: t('charging.sessions.sortEnergy', 'kWh')},
    {key: 'cost' as const, label: t('charging.sessions.sortCost', 'Cost')},
    {key: 'duration' as const, label: t('charging.sessions.sortTime', 'Time')},
    {key: 'power' as const, label: t('charging.sessions.sortPower', 'Power')},
  ];

  const activeFilters = [
    searchQuery
      ? ({
          key: 'q',
          label: t('charging.sessions.filterLabel.search', 'Search'),
          value: searchQuery,
          onRemove: () => onSearchQueryChange(''),
        } satisfies FilterChipDescriptor)
      : null,
    chargerFilter !== 'all'
      ? ({
          key: 'charger',
          label: t('charging.sessions.filterLabel.charger', 'Charger'),
          value:
            chargerFilter === 'home'
              ? t('charging.sessions.filterHome', 'Home')
              : chargerFilter === 'supercharger'
                ? t('charging.sessions.filterSC', 'SC')
                : t('charging.sessions.filterDC', 'DC'),
          onRemove: () => onChargerFilterChange('all'),
        } satisfies FilterChipDescriptor)
      : null,
  ].filter(Boolean) as FilterChipDescriptor[];

  const exportQuery = `${startDate ? `&start=${startDate}` : ''}${
    endDate ? `&end=${endDate}` : ''
  }${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`;

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <FadeIn delaySeconds={0.2}>
        <FilterBar>
          <SearchInput
            clearLabel={t('common.clear', 'Clear')}
            historyScope="charging:sessions"
            onChange={onSearchQueryChange}
            placeholder={t(
              'charging.sessions.searchPlaceholder',
              'Search by location or charger type…',
            )}
            value={searchQuery}
          />
        </FilterBar>
        <ActiveFilterChips
          filters={activeFilters}
          onClearAll={() => {
            onSearchQueryChange('');
            onChargerFilterChange('all');
          }}
        />
      </FadeIn>

      {/* Sort & Filter controls */}
      <FadeIn delaySeconds={0.22}>
        <View style={styles.controls}>
          <View style={styles.sectionTitleRow}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.sectionTitleGlyph}
              weight="bold">
              {BATTERY_CHARGING_GLYPH}
            </AppText>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('charging.sessions.allSessions', 'All Sessions')}
            </AppText>
            <AppText tone="muted" variant="caption">
              {`(${filteredSessions.length})`}
            </AppText>
          </View>

          {/* Charger filter */}
          <View style={styles.pillGroup}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.pillGroupGlyph}
              tone="muted"
              weight="bold">
              {FILTER_GLYPH}
            </AppText>
            {chargerFilterOptions.map(option => (
              <PillButton
                active={chargerFilter === option.key}
                key={option.key}
                label={option.label}
                onPress={() => onChargerFilterChange(option.key)}
              />
            ))}
          </View>

          {/* Sort controls */}
          <View style={styles.pillGroup}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.pillGroupGlyph}
              tone="muted"
              weight="bold">
              {SORT_GLYPH}
            </AppText>
            {sortOptions.map(option => (
              <PillButton
                active={sortBy === option.key}
                indicator={
                  sortBy === option.key ? (sortDesc ? '↓' : '↑') : undefined
                }
                key={option.key}
                label={option.label}
                onPress={() => handleSortClick(option.key)}
              />
            ))}
          </View>

          {/* Export buttons */}
          <View style={styles.exportRow}>
            <ExportButton
              href={`/api/v1/export/charging?format=csv${exportQuery}`}
              label={t('charging.sessions.exportCsv', 'CSV')}
            />
            <ExportButton
              href={`/api/v1/export/charging?format=json${exportQuery}`}
              label={t('charging.sessions.exportJson', 'JSON')}
            />
          </View>
        </View>
      </FadeIn>

      {/* Session cards */}
      {filteredSessions.length === 0 ? (
        <ChargingEmptyState
          title={t('charging.list.noMatches', 'No sessions match your filters')}
          message={t(
            'charging.list.noMatchesDescription',
            'Try clearing the search or charger filter to see more sessions.',
          )}
        />
      ) : (
        <View style={styles.listBlock}>
          {onBulkDelete && onClearSelection && onToggleSelected ? (
            <BulkActionsToolbar
              actions={bulkActions}
              itemNoun={{
                one: t('bulk.noun.session_one', 'charging session'),
                other: t('bulk.noun.session_other', 'charging sessions'),
              }}
              onClear={onClearSelection}
              selectedIds={Array.from(selectedIds ?? [])}
              total={filteredSessions.length}
            />
          ) : null}
          <StaggerContainer style={styles.cardStack}>
            {filteredSessions.map(s => (
              <ChargingSessionCard
                distanceUnit={distanceUnit}
                key={s.id}
                onToggleSelect={onToggleSelected}
                selected={selectedIds?.has(s.id) ?? false}
                session={s}
                t={t}
                toDistanceDisplay={toDistanceDisplay}
              />
            ))}
          </StaggerContainer>
        </View>
      )}

      {/* Pagination */}
      <Pagination
        onPageChange={onPageChange}
        onPageSizeChange={s => {
          onPageSizeChange(s);
          onPageChange(1);
        }}
        page={page}
        pageSize={pageSize}
        t={t}
        total={
          filteredSessions.length < pageSize
            ? (page - 1) * pageSize + filteredSessions.length
            : page * pageSize + 1
        }
      />
    </View>
  );
}

SessionListSection.displayName = 'SessionListSection';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },
  card: {
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
    gap: spacing.xs,
    padding: spacing.md,
  },
  cardBadges: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  cardSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  cardStack: {
    gap: spacing.md,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxGlyph: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  controls: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 18,
    letterSpacing: 0.4,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  exportButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  exportGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  exportLabel: {
    color: colors.textPrimary,
    fontSize: 12,
  },
  exportRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  listBlock: {
    gap: spacing.md,
  },
  loadingStack: {
    gap: spacing.md,
  },
  metricCost: {
    color: colors.success,
  },
  metricDistance: {
    color: colors.violet,
  },
  metricText: {
    color: colors.textSecondary,
  },
  metricsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  navButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  pageLabel: {
    paddingHorizontal: spacing.sm,
  },
  pageNavRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pageSizeGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pagination: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  paginationInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
  },
  pillActive: {
    backgroundColor: colors.surfaceHover,
  },
  pillGroup: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  pillGroupGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 14,
    paddingHorizontal: 2,
  },
  pillText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  pillTextActive: {
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    gap: spacing.md,
  },
  scoreBadge: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    minWidth: 30,
    paddingHorizontal: spacing.xs,
  },
  scoreBadgeText: {
    color: colors.accent,
  },
  searchClear: {
    alignItems: 'center',
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  searchClearGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  searchGlyph: {
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    minHeight: 44,
    minWidth: 200,
    paddingHorizontal: spacing.xs,
  },
  searchInputFocused: {
    color: colors.textPrimary,
  },
  searchRoot: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
  },
  sectionTitleGlyph: {
    color: colors.success,
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.xs,
  },
  skeletonRow: {
    backgroundColor: SKELETON_COLOR,
    borderRadius: 12,
    height: SKELETON_HEIGHT,
  },
});

const badgeVariantStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextVariantStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  danger: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
