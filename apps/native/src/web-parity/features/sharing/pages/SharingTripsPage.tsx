// Native parity port of web/src/features/sharing/pages/SharingTripsPage.tsx.
//
// SharingTripsPage surfaces recent trips eligible for sharing, keeps the
// existing share-card management hints, and conditionally renders the opt-in
// AI image-prompt drafter when AI mode and its feature toggle are enabled.
//
// The /sharing/trips route must keep working in AI-off mode (ADR-015 §I3).
// AITripPostcardShareCardImageGeneration is wrapped with withAiFeature, which
// renders null when the feature is off — so the AI card disappears from the
// native tree exactly as it does from the web DOM.
//
// Selection model (preserved from the web source):
//   - The user picks one trip from the recent-trips list. The picked trip's id
//     is the input the AI card consumes via the tripId prop. While no trip is
//     selected the AI card still renders (so the positive-control on-mode test
//     can see it) but its button is disabled with an emptyHint guiding the user
//     to pick a trip first.
//
// Browser-only → native-safe mappings (each documented in the parity sidecar):
//   - react-i18next `useTranslation` → a key-preserving i18n shim
//     (t(key)->key, t(key,'English')->'English', t(key,'English',{count}) ->
//     interpolated). Every i18n key is preserved verbatim.
//   - lucide-react `Route`/`Calendar`/`MapPin`/`Zap`/`Clock` → decorative Glyph
//     emojis (no SVG dependency); the adjacent text carries the meaning.
//   - `@/components/layout` PageContainer → web-parity layout PageContainer.
//   - `@/components/ui` GlassPanel → shared native GlassPanel.
//   - `@/components/feedback` EmptyState/Skeleton → local components (icon+message
//     EmptyState, static muted Skeleton) mirroring the ChargingDetailPage port.
//   - `@/components/motion` FadeIn → web-parity motion barrel.
//   - `@/components/data-display` InlineMetric → local component (icon + muted
//     caption value), mirroring the ChargingDetailPage port.
//   - `@/hooks/useSelectedVehicle` → native-safe shim returning the first vehicle
//     in the fleet (DOM URL + persisted selected-vehicle store UNAVAILABLE).
//   - `@/hooks/useUnits` → local shim deriving `unitPrefs.distance` from the
//     user's `unit_of_length` setting (the only useUnits surface this page reads).
//   - `@/hooks/usePageTitle` → documented native-safe no-op (no document.title;
//     the translated title still flows into PageContainer's header).
//   - `@/lib/dateFormat` formatDate + `@/lib/numberFormat` fmtInt/fmtNumber +
//     `@/lib/unitConversion` convertDistanceFromSI → inlined faithfully.
//
// Deliberate non-goals carried over from the source: this page does NOT replace
// the per-drive Share workflow and does NOT render an editable share-card form;
// the propose-only AI surface only drafts an image prompt.

import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useTrips, type Trip} from '../../../api/hooks/useTrips';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn} from '../../../components/motion';
import {AITripPostcardShareCardImageGeneration} from '../../../components/ai/AITripPostcardShareCardImageGeneration';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English';
// `t(key, 'English', { count })` -> 'English' with `{{count}}` interpolated.
type TParams = Record<string, string | number>;
type TFallback = string | (TParams & {defaultValue?: string});
type TFunc = (key: string, fallback?: TFallback, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallback, params) => {
  if (typeof fallback === 'string') {
    return interpolate(fallback, params);
  }
  if (fallback && typeof fallback === 'object') {
    return interpolate(fallback.defaultValue ?? key, fallback);
  }
  return interpolate(key, params);
};

function useTranslation(): {t: TFunc} {
  return {t: translate};
}

/* ── usePageTitle shim ─────────────────────────────────────────── */
// The web hook writes `document.title`; native has no DOM document, so this is a
// documented native-safe no-op. The translated title is still computed at the
// call site and rendered by PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  useEffect(() => {
    return undefined;
  }, [title]);
}

/* ── numberFormat (inlined from web @/lib/numberFormat) ─────────── */
// `safeNumber` collapses non-finite/non-number values to 0; `fmtNumber` is the
// locale-aware fixed-precision formatter (default precision 2, mirroring the web
// global default), `fmtInt` is `fmtNumber(v, 0)`.
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ── dateFormat (inlined from web @/lib/dateFormat formatDate) ──── */
// Date only: "Apr 4, 2026". Returns the universal "—" placeholder for
// nullish/invalid input, matching the web formatter contract.
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ── unitConversion (inlined from web @/lib/unitConversion) ─────── */
type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

/* ── useUnits shim (distance only — the surface this page reads) ── */
// Mirrors the web useUnits distance bridge: derive `unitPrefs.distance` from the
// user's `unit_of_length` setting ('mi' -> 'mi', else 'km'). The page reads only
// `unitPrefs.distance`; other useUnits surfaces are intentionally omitted.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function useUnits(): {unitPrefs: {distance: DistanceUnitPref}} {
  const {data: settings} = useSettings();
  const distance = deriveDistance(settings?.unit_of_length);
  return useMemo(() => ({unitPrefs: {distance}}), [distance]);
}

/* ── useSelectedVehicle shim (native-safe; first vehicle) ───────── */
// The web hook resolves URL path/query > persisted store > first vehicle. Native
// has no DOM URL and no cross-page selected-vehicle store, so selection falls
// back to the first vehicle in the fleet (the BatteryCellsPage precedent).
function useSelectedVehicle(): {vehicleId: number | null} {
  const {data: vehicles} = useVehicles();
  const vehicleId = vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  return {vehicleId};
}

/* ── formatDuration (the page's own helper, ported verbatim) ────── */
function formatDuration(startDate: string, endDate: string | null): string {
  if (!endDate) {
    return '—';
  }
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  const hours = Math.floor(ms / 3600000);
  const minsRaw = (ms % 3600000) / 60000;
  if (hours === 0) {
    return `${fmtInt(minsRaw)}m`;
  }
  return minsRaw >= 0.5 ? `${hours}h ${fmtInt(minsRaw)}m` : `${hours}h`;
}

/* ── Glyph (decorative emoji standing in for a lucide icon) ─────── */
function Glyph({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no"
      style={style}>
      {children}
    </AppText>
  );
}

/* ── InlineMetric (web @/components/data-display InlineMetric) ──── */
function InlineMetric({icon, value}: {icon: string; value: string}) {
  return (
    <View style={styles.inlineMetric}>
      <Glyph style={styles.inlineMetricIcon}>{icon}</Glyph>
      <AppText style={styles.inlineMetricText} tone="muted" variant="caption">
        {value}
      </AppText>
    </View>
  );
}

/* ── EmptyState (web @/components/feedback EmptyState) ──────────── */
// Mirrors the web `<EmptyState icon={...} message={...} />`: a centred decorative
// glyph above a muted message.
function EmptyState({icon, message}: {icon?: string; message: string}) {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      {icon ? <Glyph style={styles.emptyIcon}>{icon}</Glyph> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── Skeleton (web @/components/feedback Skeleton) ──────────────── */
// Static muted block; the web `animate-pulse` shimmer is simplified.
function Skeleton({style}: {style?: StyleProp<ViewStyle>}) {
  return <View style={[styles.skeleton, style]} />;
}

export default function SharingTripsPage() {
  const {t} = useTranslation();
  usePageTitle(t('sharing.trips.title', 'Share a trip'));

  const {vehicleId} = useSelectedVehicle();
  const {unitPrefs} = useUnits();

  const tripsQuery = useTrips({
    vehicle_id: vehicleId ?? undefined,
    limit: 20,
  });
  const {data: trips, isLoading} = tripsQuery;
  const allTrips = useMemo<Trip[]>(() => trips ?? [], [trips]);

  // Selected-trip id. The recent-trips list is the only selector on this page;
  // pressing a row swaps the selection, which the AI card consumes via tripId.
  const [selectedTripId, setSelectedTripId] = useState<number | undefined>(
    undefined,
  );

  return (
    <PageContainer
      title={t('sharing.trips.title', 'Share a trip')}
      subtitle={t(
        'sharing.trips.subtitle',
        'Pick a recent trip to share as a static link, postcard, or image.',
      )}
      loading={isLoading}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Recent trips list — the deterministic baseline list of shareable
            trips. Always rendered, regardless of AI mode. */}
        <FadeIn delay={0.05}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.heading} weight="semibold">
              {t('sharing.trips.recent.heading', 'Recent trips')}
            </AppText>
            {isLoading ? (
              <View style={styles.skeletonStack}>
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} style={styles.skeletonRow} />
                ))}
              </View>
            ) : allTrips.length === 0 ? (
              // no-action: trips are created automatically by the vehicle
              // driving — no manual action available.
              <EmptyState
                icon="🛣️"
                message={t(
                  'sharing.trips.recent.empty',
                  'No recent trips. Drive your vehicle to populate this list.',
                )}
              />
            ) : (
              <View
                accessibilityLabel={t(
                  'sharing.trips.recent.heading',
                  'Recent trips',
                )}
                style={styles.list}
                testID="sharing-trips-recent-list">
                {allTrips.map(trip => {
                  const isSelected = selectedTripId === trip.id;
                  const distanceDisplay = convertDistanceFromSI(
                    trip.total_distance_m,
                    unitPrefs.distance,
                  );
                  return (
                    <Pressable
                      key={trip.id}
                      accessibilityRole="button"
                      accessibilityState={{selected: isSelected}}
                      onPress={() => setSelectedTripId(trip.id)}
                      style={[
                        styles.row,
                        isSelected ? styles.rowSelected : styles.rowUnselected,
                      ]}
                      testID={`sharing-trip-${trip.id}`}>
                      <View style={styles.rowInner}>
                        <View style={styles.rowLeft}>
                          <View style={styles.avatar}>
                            <Glyph style={styles.avatarGlyph}>🛣️</Glyph>
                          </View>
                          <View style={styles.rowText}>
                            <AppText style={styles.tripName} weight="semibold">
                              {trip.name ??
                                `${t('sharing.trips.row.trip', 'Trip')} #${trip.id}`}
                            </AppText>
                            <View style={styles.metaRow}>
                              <InlineMetric
                                icon="📅"
                                value={formatDate(trip.start_date)}
                              />
                              <InlineMetric
                                icon="🕐"
                                value={formatDuration(
                                  trip.start_date,
                                  trip.end_date ?? null,
                                )}
                              />
                              <AppText
                                style={styles.drives}
                                tone="muted"
                                variant="caption">
                                {t(
                                  'sharing.trips.row.drives',
                                  '{{count}} drives',
                                  {count: trip.drive_count},
                                )}
                              </AppText>
                            </View>
                          </View>
                        </View>
                        <View style={styles.rowRight}>
                          <View style={styles.stat}>
                            <Glyph style={styles.statIconCyan}>📍</Glyph>
                            <AppText style={styles.statValue} weight="bold">
                              {`${fmtInt(distanceDisplay)} ${unitPrefs.distance}`}
                            </AppText>
                          </View>
                          <View style={styles.stat}>
                            <Glyph style={styles.statIconAmber}>⚡</Glyph>
                            <AppText style={styles.statValueAmber} weight="bold">
                              {`${fmtNumber(trip.total_energy_wh)} Wh`}
                            </AppText>
                          </View>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </GlassPanel>
        </FadeIn>

        {/* Static share-card hint — surfaces the canonical baseline publishing
            workflow (per-drive Share button) so a user who lands here without AI
            on still sees how to share. */}
        <FadeIn delay={0.1}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.hintHeading} weight="semibold">
              {t('sharing.trips.staticHint.heading', 'Static share cards')}
            </AppText>
            <AppText style={styles.hintBody} tone="secondary">
              {t(
                'sharing.trips.staticHint.body',
                'Every drive in TeslaSync can be published as a static, redacted share card from the drive detail page. Open a drive, click "Share", and copy the public link \u2014 anyone with the link can view the static card, no AI required.',
              )}
            </AppText>
          </GlassPanel>
        </FadeIn>

        {/* AI section — withAiFeature gates visibility. In off mode this renders
            null and is invisible to the native tree (ADR-015 §I5). In on mode it
            surfaces the propose-only Helix share-card image-prompt drafting card. */}
        <FadeIn delay={0.15}>
          <AITripPostcardShareCardImageGeneration tripId={selectedTripId} />
        </FadeIn>
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarGlyph: {
    fontSize: 16,
  },
  drives: {
    fontSize: 11,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  heading: {
    fontSize: 14,
    marginBottom: spacing.md,
  },
  hintBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  hintHeading: {
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  inlineMetric: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  inlineMetricIcon: {
    fontSize: 12,
  },
  inlineMetricText: {
    fontSize: 12,
  },
  list: {
    gap: spacing.sm,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: 2,
  },
  panel: {
    padding: spacing.lg,
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  rowInner: {
    gap: spacing.md,
  },
  rowLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowRight: {
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'flex-end',
  },
  rowSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  rowText: {
    flexShrink: 1,
  },
  rowUnselected: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: spacing.xl,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
  },
  skeletonRow: {
    height: 64,
  },
  skeletonStack: {
    gap: spacing.md,
  },
  stat: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statIconAmber: {
    color: colors.warning,
    fontSize: 12,
  },
  statIconCyan: {
    color: colors.accent,
    fontSize: 12,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  statValueAmber: {
    color: colors.warning,
    fontSize: 14,
  },
  tripName: {
    color: colors.textPrimary,
    fontSize: 14,
  },
});
