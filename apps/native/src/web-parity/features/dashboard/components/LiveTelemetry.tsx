// Native parity port of web/src/features/dashboard/components/LiveTelemetry.tsx.
//
// `<LiveTelemetry>` is the dashboard's six-up live-telemetry grid: a labelled
// section divider followed by six GlassPanels — Drivetrain, Climate, Security,
// Tire Pressure, Media and Navigation. Each panel reads one slice of the
// vehicle's live signals (motor / climate / security / tire / media / location),
// applies the caller-supplied unit converters at the display boundary, and shows
// a Skeleton placeholder while its data is still `undefined`.
//
// The web original composes the shared DOM kit (GlassPanel, Badge, Skeleton),
// lucide-react SVG icons (Cog/Thermometer/Shield/Zap/Snowflake/CircleDot/
// Headphones/Navigation2/ShieldCheck), the `cleanNil` / `fmtNumber` / `fmtInt`
// helpers, react-i18next (`useTranslation('dashboard')`), Tailwind utility
// classes + CSS custom properties, and CSS linear-gradient progress bars. React
// Native has none of those DOM-bound pieces, so this port reproduces the same
// behavioural + visual contract with RN primitives:
//   - GlassPanel is the already-ported native panel; the web `glow` accent
//     (purple/cyan/green box-shadow) is preserved as a tinted panel border, and
//     `hover` has no native analogue (touch, not pointer) so it is dropped.
//   - The Badge is inlined as a rounded chip with the web dark-mode variant
//     palette (success/danger/warning/neutral); `leadingGlyph` stands in for the
//     ShieldCheck child on the tire-status badge.
//   - The small lucide section/panel accent icons become short coloured text
//     glyphs (the established CostAnalysisPage SectionTitle idiom); the emoji
//     used as actual content (🔒/🔓/🛡️/🏠/🏢/⭐) are preserved verbatim.
//   - The Skeleton rows become muted placeholder Views; the gradient fan/volume
//     bars become solid-fill progress bars (RN core has no gradient), keeping the
//     cyan (fan) / violet (volume) hue intent.
//   - The responsive `grid-cols-1 sm:2 lg:3` collapses to the mobile-first single
//     column (gap-4) on native.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so `useTranslation('dashboard')` is
//     replaced by a `useDashboardTranslation()` fallback hook that returns each
//     call's English defaultValue. Every i18n key + fallback is preserved.
//   - `cleanNil` / `fmtNumber` / `fmtInt` are re-declared inline as native-safe
//     mirrors of @/lib/cleanNil + @/lib/numberFormat (all call sites pass an
//     explicit precision, so the global-precision/locale wiring is unused here).
//   - The `MotorData` / `ClimateData` / `SecurityData` / `TirePressureData` /
//     `MediaData` / `LocationData` shapes from ../types are mirrored inline so the
//     component stays self-contained (the web types module is not yet ported).

import React, {useCallback} from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';

// ---------------------------------------------------------------------------
// Native-safe mirror of the dashboard telemetry shapes from ../types (web). The
// web module is a plain interface file with no browser deps but is not yet
// ported to native; only the six slices this component reads are reproduced
// here, verbatim, so the panel stays self-contained.
// ---------------------------------------------------------------------------

export interface MotorData {
  di_torque: number | null;
  di_stator_temp: number | null;
  gear: string | null;
  lateral_accel: number | null;
  longitudinal_accel: number | null;
}

export interface ClimateData {
  inside_temp: number | null;
  outside_temp: number | null;
  hvac_power: number | null;
  hvac_fan_speed: number | null;
  defrost_mode: string | null;
  battery_heater_on: boolean;
}

export interface SecurityData {
  locked: boolean;
  sentry_mode: boolean;
  door_state: string;
  fd_window: string | null;
  fp_window: string | null;
  rd_window: string | null;
  rp_window: string | null;
}

export interface TirePressureData {
  front_left: number | null;
  front_right: number | null;
  rear_left: number | null;
  rear_right: number | null;
}

export interface MediaData {
  now_playing_title: string | null;
  now_playing_artist: string | null;
  playback_status: string | null;
  audio_volume: number | null;
  audio_volume_max: number | null;
}

export interface LocationData {
  destination_name: string | null;
  miles_to_arrival: number | null;
  minutes_to_arrival: number | null;
  located_at_home: boolean;
  located_at_work: boolean;
  located_at_favorite: boolean;
}

// ---------------------------------------------------------------------------
// Native-safe mirrors of @/lib/cleanNil + @/lib/numberFormat. Every fmtNumber
// call in this file passes an explicit precision, so the web global-precision /
// locale state is irrelevant; we format with a fixed 'en-US' locale (the web
// default) so output is deterministic.
// ---------------------------------------------------------------------------

function cleanNil(v?: string | null): string | undefined {
  if (!v || v === '<nil>' || v === 'nil' || v === 'null') {
    return undefined;
  }
  return v;
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals: number): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ---------------------------------------------------------------------------
// react-i18next is not wired in native; this fallback returns each call's
// English defaultValue (web: useTranslation('dashboard')).
// ---------------------------------------------------------------------------

type NativeTFunction = (key: string, fallback: string) => string;

function useDashboardTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export interface LiveTelemetryProps {
  motorData: MotorData | undefined;
  climateData: ClimateData | undefined;
  securityData: SecurityData | undefined;
  tireData: TirePressureData | undefined;
  mediaData: MediaData | undefined;
  locationData: LocationData | undefined;
  toTemperatureDisplay: (c: number) => number;
  toDistanceDisplay: (km: number) => number;
  toPressureDisplay: (bar: number) => number;
  tempUnit: string;
  distanceUnit: string;
  pressureUnit: string;
}

export function LiveTelemetry({
  motorData,
  climateData,
  securityData,
  tireData,
  mediaData,
  locationData,
  toTemperatureDisplay,
  toDistanceDisplay,
  toPressureDisplay,
  tempUnit,
  distanceUnit,
  pressureUnit,
}: LiveTelemetryProps) {
  const t = useDashboardTranslation();

  return (
    <View testID="live-telemetry">
      {/* Section divider */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <View style={styles.dividerTitleRow}>
          <AppText style={[styles.dividerGlyph, {color: colors.accent}]}>
            ⚙
          </AppText>
          <AppText style={styles.dividerTitle}>
            {t('telemetry.title', 'Live Telemetry')}
          </AppText>
        </View>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.grid}>
        {/* Drivetrain */}
        <DrivetrainPanel
          data={motorData}
          toTemperatureDisplay={toTemperatureDisplay}
          tempUnit={tempUnit}
        />

        {/* Climate */}
        <ClimatePanel
          data={climateData}
          toTemperatureDisplay={toTemperatureDisplay}
          tempUnit={tempUnit}
        />

        {/* Security */}
        <SecurityPanel data={securityData} />

        {/* Tire Pressure */}
        <TirePressurePanel
          data={tireData}
          toPressureDisplay={toPressureDisplay}
          pressureUnit={pressureUnit}
        />

        {/* Media */}
        <MediaPanel data={mediaData} />

        {/* Navigation */}
        <NavigationPanel
          data={locationData}
          toDistanceDisplay={toDistanceDisplay}
          distanceUnit={distanceUnit}
        />
      </View>
    </View>
  );
}

/* ———— Drivetrain Panel ———— */
function DrivetrainPanel({
  data,
  toTemperatureDisplay,
  tempUnit,
}: {
  data: MotorData | undefined;
  toTemperatureDisplay: (c: number) => number;
  tempUnit: string;
}) {
  const t = useDashboardTranslation();
  return (
    <GlassPanel style={[styles.panel, styles.panelGlowPurple]}>
      <PanelHeading
        glyph="⚙"
        glyphColor={colors.violet}
        title={t('telemetry.drivetrain', 'Drivetrain')}
      />
      {data ? (
        <View style={styles.rows25}>
          <TelemetryRow
            label={t('telemetry.torque', 'Torque')}
            value={data.di_torque != null ? `${data.di_torque} Nm` : '—'}
          />
          <TelemetryRow
            label={t('telemetry.motorTemp', 'Motor Temp')}
            value={
              data.di_stator_temp != null
                ? `${fmtInt(toTemperatureDisplay(data.di_stator_temp))}${tempUnit}`
                : '—'
            }
          />
          <View style={styles.spaceBetween}>
            <AppText style={styles.rowLabel}>
              {t('telemetry.gear', 'Gear')}
            </AppText>
            {cleanNil(data.gear) ? (
              <Badge
                variant={
                  data.gear === 'D'
                    ? 'success'
                    : data.gear === 'R'
                    ? 'danger'
                    : 'neutral'
                }
                text={cleanNil(data.gear) ?? ''}
              />
            ) : (
              <AppText style={styles.valueDash}>—</AppText>
            )}
          </View>
          <TelemetryRow
            label={t('telemetry.gforce', 'G-Force')}
            value={
              data.lateral_accel != null || data.longitudinal_accel != null
                ? `${fmtNumber(
                    Math.max(
                      Math.abs(data.lateral_accel ?? 0),
                      Math.abs(data.longitudinal_accel ?? 0),
                    ),
                    2,
                  )}g`
                : '—'
            }
          />
        </View>
      ) : (
        <SkeletonRows />
      )}
    </GlassPanel>
  );
}

/* ———— Climate Panel ———— */
function ClimatePanel({
  data,
  toTemperatureDisplay,
  tempUnit,
}: {
  data: ClimateData | undefined;
  toTemperatureDisplay: (c: number) => number;
  tempUnit: string;
}) {
  const t = useDashboardTranslation();
  return (
    <GlassPanel style={[styles.panel, styles.panelGlowCyan]}>
      <PanelHeading
        glyph="🌡"
        glyphColor={colors.accent}
        title={t('telemetry.climate', 'Climate')}
      />
      {data ? (
        <View style={styles.rows25}>
          <TelemetryRow
            label={t('telemetry.cabin', 'Cabin')}
            value={
              data.inside_temp != null
                ? `${fmtInt(toTemperatureDisplay(data.inside_temp))}${tempUnit}`
                : '—'
            }
          />
          <TelemetryRow
            label={t('telemetry.outside', 'Outside')}
            value={
              data.outside_temp != null
                ? `${fmtInt(toTemperatureDisplay(data.outside_temp))}${tempUnit}`
                : '—'
            }
          />
          <TelemetryRow
            label={t('telemetry.hvac', 'HVAC Power')}
            value={
              data.hvac_power != null
                ? `${fmtNumber(data.hvac_power, 1)} kW`
                : '—'
            }
          />
          <View>
            <View style={styles.labelRow}>
              <AppText style={styles.rowLabel}>
                {t('telemetry.fan', 'Fan')}
              </AppText>
              <AppText style={styles.miniMuted}>
                {data.hvac_fan_speed ?? 0}/6
              </AppText>
            </View>
            <ProgressBar
              pct={((data.hvac_fan_speed ?? 0) / 6) * 100}
              fillColor={colors.accent}
            />
          </View>
          <View style={styles.chipsRow}>
            {data.defrost_mode && data.defrost_mode !== 'Off' && (
              <Chip tone="blue" glyph="❄" text={t('telemetry.defrost', 'Defrost')} />
            )}
            {data.battery_heater_on && (
              <Chip
                tone="orange"
                glyph="⚡"
                text={t('telemetry.batHeater', 'Bat Heater')}
              />
            )}
            {(!data.defrost_mode || data.defrost_mode === 'Off') &&
              !data.battery_heater_on && (
                <AppText style={styles.miniMuted}>
                  {t('telemetry.noModes', 'No active modes')}
                </AppText>
              )}
          </View>
        </View>
      ) : (
        <SkeletonRows />
      )}
    </GlassPanel>
  );
}

/* ———— Security Panel ———— */
function SecurityPanel({data}: {data: SecurityData | undefined}) {
  const t = useDashboardTranslation();

  if (!data) {
    return (
      <GlassPanel style={[styles.panel, styles.panelGlowGreen]}>
        <PanelHeading
          glyph="🛡"
          glyphColor={colors.success}
          title={t('telemetry.security', 'Security')}
        />
        <SkeletonRows />
      </GlassPanel>
    );
  }

  const doorStates = (data.door_state ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const openDoors = doorStates.filter(s => s.toLowerCase().includes('open'));
  const windows = [
    {label: 'FD', val: data.fd_window},
    {label: 'FP', val: data.fp_window},
    {label: 'RD', val: data.rd_window},
    {label: 'RP', val: data.rp_window},
  ];
  const openWindows = windows.filter(
    w => w.val && w.val.toLowerCase() !== 'closed',
  );

  return (
    <GlassPanel style={[styles.panel, styles.panelGlowGreen]}>
      <PanelHeading
        glyph="🛡"
        glyphColor={colors.success}
        title={t('telemetry.security', 'Security')}
      />
      <View style={styles.rows25}>
        <View style={styles.spaceBetween}>
          <AppText style={styles.rowLabel}>
            {t('telemetry.lock', 'Lock')}
          </AppText>
          <AppText
            style={[
              styles.statusValue,
              {color: data.locked ? colors.success : colors.danger},
            ]}>
            {data.locked ? '🔒' : '🔓'}{' '}
            {data.locked
              ? t('telemetry.locked', 'Locked')
              : t('telemetry.unlocked', 'Unlocked')}
          </AppText>
        </View>
        <View style={styles.spaceBetween}>
          <AppText style={styles.rowLabel}>
            {t('telemetry.sentry', 'Sentry')}
          </AppText>
          <AppText
            style={[
              styles.statusValue,
              {color: data.sentry_mode ? colors.accent : colors.textMuted},
            ]}>
            🛡️{' '}
            {data.sentry_mode
              ? t('telemetry.active', 'Active')
              : t('telemetry.off', 'Off')}
          </AppText>
        </View>
        <View style={styles.spaceBetween}>
          <AppText style={styles.rowLabel}>
            {t('telemetry.doors', 'Doors')}
          </AppText>
          <Badge
            variant={openDoors.length === 0 ? 'success' : 'warning'}
            text={
              openDoors.length === 0
                ? t('telemetry.allClosed', 'All Closed')
                : `${openDoors.length} ${t('telemetry.open', 'Open')}`
            }
          />
        </View>
        <View style={styles.spaceBetween}>
          <AppText style={styles.rowLabel}>
            {t('telemetry.windows', 'Windows')}
          </AppText>
          <Badge
            variant={openWindows.length === 0 ? 'success' : 'warning'}
            text={
              openWindows.length === 0
                ? t('telemetry.allClosed', 'All Closed')
                : `${openWindows.length} ${t('telemetry.open', 'Open')}`
            }
          />
        </View>
      </View>
    </GlassPanel>
  );
}

/* ———— Tire Pressure Panel ———— */
function TirePressurePanel({
  data,
  toPressureDisplay,
  pressureUnit,
}: {
  data: TirePressureData | undefined;
  toPressureDisplay: (bar: number) => number;
  pressureUnit: string;
}) {
  const t = useDashboardTranslation();

  if (!data) {
    return (
      <GlassPanel style={[styles.panel, styles.panelGlowCyan]}>
        <PanelHeading
          glyph="◉"
          glyphColor={colors.accent}
          title={t('telemetry.tirePressure', 'Tire Pressure')}
        />
        <SkeletonRows />
      </GlassPanel>
    );
  }

  const tires = [
    {label: 'FL', value: data.front_left},
    {label: 'FR', value: data.front_right},
    {label: 'RL', value: data.rear_left},
    {label: 'RR', value: data.rear_right},
  ];

  const getPressureColor = (bar: number | null): string => {
    if (bar == null) {
      return colors.textMuted;
    }
    if (bar < 2.068 || bar > 3.103) {
      return colors.danger;
    }
    if (bar < 2.275 || bar > 2.896) {
      return colors.warning;
    }
    return colors.success;
  };

  const allNormal = tires.every(tire => {
    if (tire.value == null) {
      return true;
    }
    return tire.value >= 2.275 && tire.value <= 2.896;
  });

  return (
    <GlassPanel style={[styles.panel, styles.panelGlowCyan]}>
      <PanelHeading
        glyph="◉"
        glyphColor={colors.accent}
        title={t('telemetry.tirePressure', 'Tire Pressure')}
      />
      <View style={styles.rows3}>
        <View style={styles.tireGrid}>
          {tires.map(tire => (
            <View key={tire.label} style={styles.tireCell}>
              <AppText style={styles.tireLabel}>{tire.label}</AppText>
              <AppText style={[styles.tireValue, {color: getPressureColor(tire.value)}]}>
                {tire.value != null
                  ? fmtNumber(toPressureDisplay(tire.value), 1)
                  : '—'}
              </AppText>
              <AppText style={styles.tireUnit}>{pressureUnit}</AppText>
            </View>
          ))}
        </View>
        <View style={styles.centerRow}>
          <Badge
            variant={allNormal ? 'success' : 'warning'}
            leadingGlyph="🛡"
            text={
              allNormal
                ? t('telemetry.allNormal', 'All Normal')
                : t('telemetry.warning', 'Warning')
            }
          />
        </View>
      </View>
    </GlassPanel>
  );
}

/* ———— Media Panel ———— */
function MediaPanel({data}: {data: MediaData | undefined}) {
  const t = useDashboardTranslation();
  return (
    <GlassPanel style={[styles.panel, styles.panelGlowPurple]}>
      <PanelHeading
        glyph="🎧"
        glyphColor={colors.violet}
        title={t('telemetry.media', 'Media')}
      />
      {data ? (
        <View style={styles.rows25}>
          <View>
            <AppText style={styles.mediaTitle} numberOfLines={1}>
              {cleanNil(data.now_playing_title) || '—'}
            </AppText>
            <AppText style={styles.mediaArtist} numberOfLines={1}>
              {cleanNil(data.now_playing_artist) ||
                t('telemetry.unknownArtist', 'Unknown artist')}
            </AppText>
          </View>
          <View style={styles.spaceBetween}>
            <AppText style={styles.rowLabel}>
              {t('telemetry.status', 'Status')}
            </AppText>
            <Badge
              variant={
                cleanNil(data.playback_status) === 'Playing'
                  ? 'success'
                  : cleanNil(data.playback_status) === 'Paused'
                  ? 'warning'
                  : 'neutral'
              }
              text={cleanNil(data.playback_status) ?? '—'}
            />
          </View>
          <View>
            <View style={styles.labelRow}>
              <AppText style={styles.rowLabel}>
                {t('telemetry.volume', 'Volume')}
              </AppText>
              <AppText style={styles.miniMuted}>
                {data.audio_volume != null ? `${data.audio_volume}` : '—'}
                {data.audio_volume_max != null
                  ? `/${data.audio_volume_max}`
                  : ''}
              </AppText>
            </View>
            <ProgressBar
              pct={
                data.audio_volume != null && data.audio_volume_max
                  ? (data.audio_volume / data.audio_volume_max) * 100
                  : 0
              }
              fillColor={colors.violet}
            />
          </View>
        </View>
      ) : (
        <SkeletonRows />
      )}
    </GlassPanel>
  );
}

/* ———— Navigation Panel ———— */
function NavigationPanel({
  data,
  toDistanceDisplay,
  distanceUnit,
}: {
  data: LocationData | undefined;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
}) {
  const t = useDashboardTranslation();
  return (
    <GlassPanel style={[styles.panel, styles.panelGlowCyan]}>
      <PanelHeading
        glyph="🧭"
        glyphColor={colors.accent}
        title={t('telemetry.navigation', 'Navigation')}
      />
      {data ? (
        <View style={styles.rows25}>
          <TelemetryRow
            label={t('telemetry.destination', 'Destination')}
            value={data.destination_name || '—'}
          />
          <TelemetryRow
            label={t('telemetry.distance', 'Distance')}
            value={
              data.miles_to_arrival != null
                ? `${fmtNumber(
                    toDistanceDisplay(data.miles_to_arrival),
                    1,
                  )} ${distanceUnit}`
                : '—'
            }
          />
          <TelemetryRow
            label={t('telemetry.eta', 'ETA')}
            value={
              data.minutes_to_arrival != null
                ? `${fmtInt(data.minutes_to_arrival)} min`
                : '—'
            }
          />
          <View style={styles.chipsRow}>
            {data.located_at_home && (
              <Chip tone="green" glyph="🏠" text={t('telemetry.home', 'Home')} />
            )}
            {data.located_at_work && (
              <Chip tone="blue" glyph="🏢" text={t('telemetry.work', 'Work')} />
            )}
            {data.located_at_favorite && (
              <Chip
                tone="purple"
                glyph="⭐"
                text={t('telemetry.favorite', 'Favorite')}
              />
            )}
            {!data.located_at_home &&
              !data.located_at_work &&
              !data.located_at_favorite && (
                <AppText style={styles.miniMuted}>
                  {t('telemetry.noSavedLocation', 'No saved location')}
                </AppText>
              )}
          </View>
        </View>
      ) : (
        <SkeletonRows />
      )}
    </GlassPanel>
  );
}

/* ———— Shared helpers ———— */
function TelemetryRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.spaceBetween}>
      <AppText style={styles.rowLabel}>{label}</AppText>
      <AppText style={styles.rowValue} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

function SkeletonRows() {
  return (
    <View style={styles.rows25} testID="telemetry-skeleton">
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={styles.skeleton} />
      ))}
    </View>
  );
}

/* ———— Panel heading (web lucide icon + uppercase title) ———— */
function PanelHeading({
  glyph,
  glyphColor,
  title,
}: {
  glyph: string;
  glyphColor: string;
  title: string;
}) {
  return (
    <View style={styles.panelHeadingRow}>
      <AppText style={[styles.panelHeadingGlyph, {color: glyphColor}]}>
        {glyph}
      </AppText>
      <AppText style={styles.panelHeadingText}>{title}</AppText>
    </View>
  );
}

/* ———— Inlined native Badge (web @/components/ui Badge) ———— */
type BadgeVariant = 'success' | 'danger' | 'warning' | 'neutral';

function Badge({
  variant = 'neutral',
  leadingGlyph,
  text,
}: {
  variant?: BadgeVariant;
  leadingGlyph?: string;
  text: string;
}) {
  return (
    <View style={[styles.badge, badgeBgStyles[variant]]}>
      {leadingGlyph ? (
        <AppText style={[styles.badgeGlyph, badgeTextStyles[variant]]}>
          {leadingGlyph}
        </AppText>
      ) : null}
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {text}
      </AppText>
    </View>
  );
}

/* ———— Inlined native status Chip (web bg-X-500/10 text-X-400 pill) ———— */
type ChipTone = 'blue' | 'orange' | 'green' | 'purple';

function Chip({
  tone,
  glyph,
  text,
}: {
  tone: ChipTone;
  glyph: string;
  text: string;
}) {
  return (
    <View style={[styles.chip, chipBgStyles[tone]]}>
      <AppText style={[styles.chipGlyph, chipTextStyles[tone]]}>{glyph}</AppText>
      <AppText style={[styles.chipText, chipTextStyles[tone]]}>{text}</AppText>
    </View>
  );
}

/* ———— Solid-fill progress bar (web gradient bar) ———— */
function ProgressBar({pct, fillColor}: {pct: number; fillColor: string}) {
  const width: DimensionValue = `${Math.max(Math.min(pct, 100), 0)}%`;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, {width, backgroundColor: fillColor}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Section divider: hairline — title — hairline (web gradient lines).
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  dividerGlyph: {
    fontSize: 16,
    lineHeight: 18,
  },
  dividerTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  // grid-cols-1 (mobile base) + gap-4.
  grid: {
    gap: 16,
  },
  // GlassPanel p-4 (rounded corners come from GlassPanel).
  panel: {
    borderRadius: 20,
    padding: 16,
  },
  // Web `glow` accent preserved as a tinted panel border.
  panelGlowPurple: {
    borderColor: colors.violetBorder,
  },
  panelGlowCyan: {
    borderColor: colors.borderAccent,
  },
  panelGlowGreen: {
    borderColor: colors.successBorder,
  },
  panelHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  panelHeadingGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  panelHeadingText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  // space-y-2.5 / space-y-3 stacks.
  rows25: {
    gap: 10,
  },
  rows3: {
    gap: 12,
  },
  spaceBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rowLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    maxWidth: 120,
    textAlign: 'right',
  },
  valueDash: {
    color: colors.textMuted,
    fontSize: 14,
  },
  miniMuted: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  // Badge: inline-flex items-center gap-1 rounded-full px-1.5 py-0.5.
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  badgeGlyph: {
    fontSize: 11,
    lineHeight: 16,
  },
  // Chip: text-[10px] px-1.5 py-0.5 rounded-full bg-X-500/10 text-X-400.
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipText: {
    fontSize: 10,
    lineHeight: 14,
  },
  chipGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  chipsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Progress bar: h-1.5 rounded-full bg-white/[0.06] track.
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  // Tire 2-col grid + per-tire cell.
  tireGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tireCell: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  tireLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  tireValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  tireUnit: {
    color: colors.textMuted,
    fontSize: 9,
  },
  centerRow: {
    alignItems: 'center',
  },
  mediaTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  mediaArtist: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  skeleton: {
    height: 20,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
  },
});

const badgeBgStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {backgroundColor: '#14532d'},
  danger: {backgroundColor: '#7f1d1d'},
  warning: {backgroundColor: '#713f12'},
  neutral: {backgroundColor: '#374151'},
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {color: '#bbf7d0'},
  danger: {color: '#fecaca'},
  warning: {color: '#fef08a'},
  neutral: {color: '#e5e7eb'},
});

const chipBgStyles = StyleSheet.create<Record<ChipTone, ViewStyle>>({
  blue: {backgroundColor: 'rgba(59, 130, 246, 0.1)'},
  orange: {backgroundColor: 'rgba(249, 115, 22, 0.1)'},
  green: {backgroundColor: 'rgba(34, 197, 94, 0.1)'},
  purple: {backgroundColor: 'rgba(168, 85, 247, 0.1)'},
});

const chipTextStyles = StyleSheet.create<Record<ChipTone, TextStyle>>({
  blue: {color: '#60a5fa'},
  orange: {color: '#fb923c'},
  green: {color: '#4ade80'},
  purple: {color: '#c084fc'},
});

LiveTelemetry.displayName = 'LiveTelemetry';

export default LiveTelemetry;
