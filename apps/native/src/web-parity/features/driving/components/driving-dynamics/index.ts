/**
 * Native parity barrel for
 * web/src/features/driving/components/driving-dynamics/index.ts.
 *
 * The web module is a pure re-export barrel that forwards eleven
 * default-exported driving-dynamics building blocks (live motor status, the
 * G-force / pedal-usage / speed-gear panels, the autopilot, motor-history and
 * motor-efficiency sections, summary stats, the driving-coach and
 * drive-analytics sections, and the driving-tips list). Every sibling is a
 * DOM + Recharts (SVG) chart or a Tailwind/web-UI panel that has not yet been
 * ported to its own native file, so this barrel preserves the identical public
 * export surface by exposing native-safe placeholder components. Each
 * placeholder renders an explicit "native port pending" state through the
 * shared GlassPanel + AppText primitives instead of importing any browser-only
 * module (no DOM, Recharts, Leaflet, or web UI). When a sibling gains a
 * dedicated native port, replace its placeholder below with a re-export of that
 * file.
 */

import React, {type ReactElement} from 'react';
import {StyleSheet} from 'react-native';

import {spacing} from '../../../../../theme/tokens';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

/**
 * Permissive structural stand-ins for the web prop types. The real domain types
 * (MotorSnapshot, MotorStats, ThrottleStyle, Drive, DrivingCoachData,
 * TemperatureUnitPref) live in the not-yet-ported driving feature modules;
 * these interfaces keep the same prop names so future native call sites compile
 * unchanged, and the placeholder bodies ignore the values until each section is
 * fully ported. No `any` is used. `ObjectLike` is the structural stand-in for
 * the object-shaped domain props; it is `object` (not
 * `Record<string, unknown>`) so the real interface-typed payloads
 * (MotorSnapshot, Drive, DrivingCoachData, MotorStats), which lack an implicit
 * string index signature, remain assignable.
 */
type ObjectLike = object;
type NumberToNumber = (value: number) => number;

interface LiveMotorStatusProps {
  motorLatest?: ObjectLike | null;
  toTemperatureDisplay: NumberToNumber;
  // tempUnit already includes the degree symbol (e.g. '°C') — never re-prefix.
  tempUnit: string;
}
interface GForcePanelProps {
  vehicleId?: number | null;
}
interface PedalUsageProps {
  vehicleId?: number | null;
}
interface SpeedGearPanelProps {
  motorLatest?: ObjectLike | null;
  filteredDrives: ReadonlyArray<ObjectLike>;
  toSpeedDisplay: NumberToNumber;
  speedUnit: string;
}
interface AutopilotSectionProps {
  vehicleId?: number | null;
}
interface MotorHistoryChartsProps {
  motorHistory?: ReadonlyArray<ObjectLike>;
  toSpeedDisplay: NumberToNumber;
  speedUnit: string;
}
interface MotorEfficiencyInsightsProps {
  motorStats?: ObjectLike | null;
  // throttleStyle is the web `ThrottleStyle` string union
  // ('conservative' | 'moderate' | 'aggressive'), not an object.
  throttleStyle?: string | null;
  toTemperatureDisplay: NumberToNumber;
  // tempUnit already includes the degree symbol (e.g. '°C') — never re-prefix.
  tempUnit: string;
}
interface SummaryStatsProps {
  motorStats?: ObjectLike | null;
  toTemperatureDisplay: NumberToNumber;
  // tempUnit already includes the degree symbol (e.g. '°C') — never re-prefix.
  tempUnit: string;
}
interface DrivingCoachSectionProps {
  coachData?: ObjectLike;
}
interface DriveAnalyticsSectionProps {
  filteredDrives: ReadonlyArray<ObjectLike>;
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  toDistanceDisplay: NumberToNumber;
  toSpeedDisplay: NumberToNumber;
  distanceUnit: string;
  speedUnit: string;
}
interface DrivingTipsProps {
  motorStats?: ObjectLike | null;
  // throttleStyle is the web `ThrottleStyle` string union
  // ('conservative' | 'moderate' | 'aggressive'), not an object.
  throttleStyle?: string | null;
}

type PlaceholderComponent<P> = (props: P) => ReactElement;

const KICKER_LABEL = 'Driving dynamics';
const UNAVAILABLE_HINT = 'Native port pending';

function renderPlaceholder(section: string): ReactElement {
  return React.createElement(GlassPanel, {
    style: styles.panel,
    children: [
      React.createElement(
        AppText,
        {
          key: 'kicker',
          variant: 'caption',
          tone: 'muted',
          style: styles.kicker,
        },
        KICKER_LABEL,
      ),
      React.createElement(
        AppText,
        {key: 'section', weight: 'semibold'},
        section,
      ),
      React.createElement(
        AppText,
        {key: 'hint', variant: 'caption', tone: 'muted'},
        UNAVAILABLE_HINT,
      ),
    ],
  });
}

export const LiveMotorStatus: PlaceholderComponent<LiveMotorStatusProps> = () =>
  renderPlaceholder('Live motor status');

export const GForcePanel: PlaceholderComponent<GForcePanelProps> = () =>
  renderPlaceholder('G-force');

export const PedalUsage: PlaceholderComponent<PedalUsageProps> = () =>
  renderPlaceholder('Pedal usage');

export const SpeedGearPanel: PlaceholderComponent<SpeedGearPanelProps> = () =>
  renderPlaceholder('Speed & gear');

export const AutopilotSection: PlaceholderComponent<
  AutopilotSectionProps
> = () => renderPlaceholder('Autopilot');

export const MotorHistoryCharts: PlaceholderComponent<
  MotorHistoryChartsProps
> = () => renderPlaceholder('Motor history charts');

export const MotorEfficiencyInsights: PlaceholderComponent<
  MotorEfficiencyInsightsProps
> = () => renderPlaceholder('Motor efficiency insights');

export const SummaryStats: PlaceholderComponent<SummaryStatsProps> = () =>
  renderPlaceholder('Summary stats');

export const DrivingCoachSection: PlaceholderComponent<
  DrivingCoachSectionProps
> = () => renderPlaceholder('Driving coach');

export const DriveAnalyticsSection: PlaceholderComponent<
  DriveAnalyticsSectionProps
> = () => renderPlaceholder('Drive analytics');

export const DrivingTips: PlaceholderComponent<DrivingTipsProps> = () =>
  renderPlaceholder('Driving tips');

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  kicker: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
