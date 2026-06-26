// Native parity port of web/src/features/vehicles/components/RecentActivity.tsx.
//
// Renders the vehicle dashboard's two-panel "recent activity" cluster: a list of
// recent drives (distance + duration + SoC delta) and a list of recent charging
// sessions (energy + duration + SoC delta), each with a "View all" link and an
// empty state. The web file leans on browser-only dependencies that are absent
// from the native parity manifest (contract rules 4, 5 & 7); each is replaced
// with a React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-router-dom `Link` (web L1, L33, L43, L93, L103) -> a React Native
//     Pressable with accessibilityRole="link" that calls the optional
//     `onNavigate(path)` prop. The native web-parity tree has no in-app router,
//     so each route target ('/drives', `/drives/${id}`, '/charging',
//     `/charging/${id}`) is preserved on the prop and navigation is delegated to
//     the host screen (matching the dashboard RecentActivity / HistoryListRow
//     ports).
//   - react-i18next `useTranslation` (web L2, L21) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('common.x', 'English') call keeps its English default + key intent.
//   - lucide-react icons (web L3): Route / BatteryCharging render as the shared
//     native SemanticIcon ('drive' accent/cyan, 'batteryCharging' success/green)
//     for the panel headers; the per-row IconBox+Route and IconBox+Zap collapse
//     into a single SemanticIcon ('drive' for drives, 'charging' for charges)
//     whose tone-coloured box reproduces the web IconBox cyan/green container,
//     so the per-type colour signal survives; Clock -> SemanticIcon 'clock'
//     inside the InlineMetric; ChevronRight -> a small '›' AppText glyph.
//   - @/components/ui/GlassPanel (web L4) -> the shared native GlassPanel.
//   - @/components/ui/IconBox (web L5) -> collapsed into the SemanticIcon box
//     (see lucide note above); the web cyan/green container colour maps to the
//     SemanticIcon accent/success tone.
//   - @/components/motion/FadeIn (web L6) -> a local Animated.View mount fade
//     reproducing the framer-motion entry (opacity 0->1, translateY 12->0,
//     400ms easeOut, after the caller `delay` in seconds).
//   - @/components/data-display InlineMetric / AnimatedNumber / TimeStamp
//     (web L7-9) -> the ported native parity components (same contracts).
//   - @/hooks/useUnits useUnits().unitPrefs (web L10, L22) -> the ported native
//     useFormatPrefs().distanceUnit (settings-derived 'km' | 'mi'); the
//     suffix/target preserve unitPrefs.distance verbatim.
//   - @/lib/unitConversion convertDistanceFromSI + convertEnergyFromSI (web L11)
//     -> convertDistanceFromSI imported from the ported format primitives;
//     convertEnergyFromSI ported inline (Wh -> kWh = wh/1000) verbatim.
//   - @/lib/numberFormat fmtInt (web L12, L66, L126) -> useFormatPrefs().fmt(v, 0)
//     (the native locale-aware formatter at 0 decimals).
//   - @/api/types Drive / ChargingSession (web L13) -> imported from the ported
//     native web-parity api/types (identical SI-canonical field shapes).
//
// No DOM-only modules, HTML elements, react-router-dom, react-i18next,
// lucide-react, Recharts, Leaflet, or web UI components are imported -- only
// react, react-native primitives, the shared native SemanticIcon / AppText /
// GlassPanel / theme tokens, and the ported parity InlineMetric / AnimatedNumber
// / TimeStamp / format primitives.

import React, {useEffect, useRef, type ReactNode} from 'react';
import {Animated, Easing, Pressable, StyleSheet, View} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import type {ChargingSession, Drive} from '../../../api/types';
import {AnimatedNumber} from '../../../components/data-display/AnimatedNumber';
import {InlineMetric} from '../../../components/data-display/InlineMetric';
import {TimeStamp} from '../../../components/data-display/TimeStamp';
import {
  convertDistanceFromSI,
  useFormatPrefs,
} from '../../../components/data-display/format/_formatPrimitives';

/** FadeIn entry timing — mirrors the web framer-motion FadeIn duration. */
const FADE_DURATION_MS = 400;

/** Arrow between start/end SoC (web `→`, U+2192). */
const ARROW = '\u2192';

// ── react-i18next useTranslation replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

/** Returns the English fallback so the translation-key intent is preserved. */
function useNativeTranslation(): NativeTFunction {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

// ── @/lib/unitConversion convertEnergyFromSI (ported inline, verbatim) ──
type EnergyUnit = 'Wh' | 'kWh';

function convertEnergyFromSI(wh: number, to: EnergyUnit): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

/**
 * `@/components/motion` FadeIn -> Animated.View mount fade reproducing the web
 * framer-motion entry: opacity 0->1, translateY 12->0, 400ms easeOut, after the
 * caller-supplied `delay` (seconds, like the web prop).
 */
function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: FADE_DURATION_MS,
      delay: delay * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/**
 * Shared panel chrome for the two activity lists: header (icon + title) + the
 * "View all" link, wrapped in the FadeIn entry. The list / empty state is passed
 * as `children` so each caller keeps its own data branch (web L40-81 / L100-141).
 */
function ActivityPanel({
  delay,
  iconName,
  title,
  viewAllRoute,
  onNavigate,
  children,
}: {
  delay: number;
  iconName: SemanticIconName;
  title: string;
  viewAllRoute: string;
  onNavigate?: (path: string) => void;
  children: ReactNode;
}) {
  const t = useNativeTranslation();
  return (
    <FadeIn delay={delay}>
      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          <View style={styles.titleGroup}>
            <SemanticIcon decorative name={iconName} size="sm" />
            <AppText style={styles.sectionTitle}>{title}</AppText>
          </View>
          <Pressable
            accessibilityRole="link"
            onPress={() => onNavigate?.(viewAllRoute)}
            style={styles.viewAll}>
            <AppText style={styles.viewAllText}>
              {t('common.viewAll', 'View all')}
            </AppText>
            <AppText style={styles.viewAllChevron}>{'\u203A'}</AppText>
          </Pressable>
        </View>
        {children}
      </GlassPanel>
    </FadeIn>
  );
}

/**
 * A single activity row (drive or charge): leading SemanticIcon box + a main
 * column (animated primary value + relative timestamp) + a right column
 * (duration InlineMetric + optional SoC delta). Wraps the web `Link` row
 * (web L43-74 / L103-134) as a Pressable that delegates to onNavigate.
 */
function ActivityRow({
  iconName,
  valueNode,
  timeValue,
  durationText,
  socText,
  onPress,
}: {
  iconName: SemanticIconName;
  valueNode: ReactNode;
  timeValue: string | null | undefined;
  durationText: string;
  socText: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({pressed}) => [styles.itemRow, pressed && styles.itemPressed]}>
      <SemanticIcon decorative name={iconName} size="sm" />
      <View style={styles.itemMain}>
        {valueNode}
        <TimeStamp style={styles.itemTime} value={timeValue} />
      </View>
      <View style={styles.itemRight}>
        <InlineMetric
          icon={<SemanticIcon decorative name="clock" size="sm" />}
          value={durationText}
        />
        {socText != null ? (
          <AppText style={styles.socText}>{socText}</AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

interface RecentActivityProps {
  drives: Drive[] | undefined;
  sessions: ChargingSession[] | undefined;
  /**
   * Native-only: routes a link target ('/drives', `/drives/${id}`, '/charging',
   * `/charging/${id}`). The web-parity tree has no in-app router, so navigation
   * is delegated to the host screen.
   */
  onNavigate?: (path: string) => void;
}

export function RecentActivity({
  drives,
  sessions,
  onNavigate,
}: RecentActivityProps) {
  const t = useNativeTranslation();
  const {distanceUnit, fmt} = useFormatPrefs();

  return (
    <View style={styles.container}>
      {/* Recent Drives */}
      <ActivityPanel
        delay={0.25}
        iconName="drive"
        title={t('common.recentDrives', 'Recent Drives')}
        viewAllRoute="/drives"
        onNavigate={onNavigate}>
        {drives && drives.length > 0 ? (
          <View style={styles.list}>
            {drives.slice(0, 5).map(d => (
              <ActivityRow
                key={d.id}
                iconName="drive"
                valueNode={
                  <AnimatedNumber
                    decimals={1}
                    style={styles.itemValue}
                    suffix={` ${distanceUnit}`}
                    value={convertDistanceFromSI(d.distance_m ?? 0, distanceUnit)}
                  />
                }
                timeValue={d.start_ts}
                durationText={`${Math.floor(d.duration_s / 3600)}h ${fmt(
                  Math.floor((d.duration_s % 3600) / 60),
                  0,
                )}m`}
                socText={
                  d.start_soc_pct != null && d.end_soc_pct != null
                    ? `${d.start_soc_pct}% ${ARROW} ${d.end_soc_pct}%`
                    : null
                }
                onPress={() => onNavigate?.(`/drives/${d.id}`)}
              />
            ))}
          </View>
        ) : (
          <AppText style={styles.emptyText}>
            {t('common.noDrives', 'No drives recorded yet')}
          </AppText>
        )}
      </ActivityPanel>

      {/* Recent Charging Sessions */}
      <ActivityPanel
        delay={0.27}
        iconName="batteryCharging"
        title={t('common.recentCharges', 'Recent Charges')}
        viewAllRoute="/charging"
        onNavigate={onNavigate}>
        {sessions && sessions.length > 0 ? (
          <View style={styles.list}>
            {sessions.slice(0, 5).map(s => (
              <ActivityRow
                key={s.id}
                iconName="charging"
                valueNode={
                  <AnimatedNumber
                    decimals={1}
                    style={styles.itemValue}
                    suffix=" kWh"
                    value={convertEnergyFromSI(s.total_energy_added_wh, 'kWh')}
                  />
                }
                timeValue={s.start_ts}
                durationText={`${Math.floor(s.duration_min / 60)}h ${fmt(
                  s.duration_min % 60,
                  0,
                )}m`}
                socText={
                  s.end_soc_pct != null
                    ? `${s.start_soc_pct}% ${ARROW} ${s.end_soc_pct}%`
                    : null
                }
                onPress={() => onNavigate?.(`/charging/${s.id}`)}
              />
            ))}
          </View>
        ) : (
          <AppText style={styles.emptyText}>
            {t('common.noCharges', 'No charging sessions recorded yet')}
          </AppText>
        )}
      </ActivityPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingVertical: 24,
    textAlign: 'center',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  itemMain: {
    flex: 1,
    gap: 2,
  },
  itemPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  itemRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  itemRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  itemTime: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  itemValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  list: {
    gap: 8,
  },
  panel: {
    padding: 24,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  socText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  viewAll: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  viewAllChevron: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  viewAllText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});
