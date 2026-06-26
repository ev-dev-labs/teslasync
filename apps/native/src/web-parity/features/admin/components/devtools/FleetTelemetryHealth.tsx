// Native parity port of
// web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx.
//
// `FleetTelemetryHealth` is a devtools panel with two stacked cards: an "Error
// VINs" summary (count badge + optional active-filter chip + "Refresh from
// Tesla" button, then a table of vehicles with telemetry config errors) and an
// "Error Log" (refresh button + paginated table of individual error records).
// Clicking a VIN row toggles a server-side `vin` filter on the error log.
//
// State, hook calls, API query keys, and i18n keys are preserved verbatim from
// the web source. The web source pulls several modules with no native-parity
// surface, mapped per the conversion contract (rules 4/5/7):
//   - react-i18next `useTranslation` (L2) -> the standard web-parity i18n shim
//     returning the inline English fallback (deps lack react-i18next), so the
//     component body's `t('key', 'English')` calls are unchanged.
//   - lucide-react `AlertTriangle` / `AlertCircle` / `RefreshCw` (L3, SVG) have
//     no native analog -> decorative AppText glyphs ('\u26a0' warning triangle,
//     '!' alert, '\u21bb' refresh). The refresh glyph is swapped for an
//     `ActivityIndicator` while the mutation is pending (the web `Button`
//     `loading` spinner).
//   - `Button as UiButton` (L4) from `@/components/ui` has no native parity
//     port. Its three uses are rebuilt with `Pressable` + `AppText`: the VIN
//     cell link (ghost, mono cyan), the filter-chip close "\u00d7" (ghost), and
//     the two "Refresh from Tesla" buttons (secondary + loading + icon), each
//     keeping its onClick handler, disabled-while-loading, and aria-label.
//   - `Skeleton` (L6) from `@/components/feedback` has no native parity port ->
//     a muted fixed-height `SkeletonBlock` placeholder (h-24 -> 96, h-40 ->
//     160), flagged decorative for a11y.
//   - `cn` (L7) only merged Tailwind strings; React Native has no className, so
//     all class-driven styling moves to `StyleSheet` + inline literals.
//   - `ToolCard` (L13, sibling `./ToolCard`) is not ported yet, so its card
//     chrome (GlassPanel p-5 + tinted 40x40 icon box + title/description) is
//     reproduced by a local `ToolCard` helper to keep this file self-contained
//     and type-safe (the same "own the unported sibling locally" approach used
//     by the HealthRow port). `icon`/`color` collapse to a `tone` + `glyph`.
//
// Parity components reused as-is: `Badge`, `DataTable`/`Column` (web-parity ui)
// and `TimeStamp` (web-parity data-display). The interactive "Filtered" chip is
// hand-built rather than using `Badge` because the parity `Badge` wraps all
// children in a single `AppText`, which cannot host an interactive close
// control; it reuses the parity Badge `info` tint (dark:bg-blue-900 #1e3a8a /
// dark:text-blue-200 #bfdbfe) for an identical look.
//
// Visual intent: neon-red/neon-amber icon-box tints -> danger/warning surface +
// border + foreground tokens. Tailwind body-text classes map to the toned-down
// SI palette per the frontend rules: text-cyan-300 -> #67e8f9, text-rose-300 ->
// #fda4af, text-amber-300 -> #fcd34d; --text-primary/secondary/muted ->
// colors.textPrimary/textSecondary/textMuted. font-mono -> Platform.select
// monospace. Tailwind spacing -> px (space-y-4 -> gap 16, space-y-3 -> gap 12,
// gap-3 -> 12, text-xs -> 12/16, text-sm -> 14, rounded-lg -> 8, p-5 -> 20,
// h-10/w-10 -> 40). The web `hover:underline` / `hover:bg-*` affordances have no
// touch analog and collapse into Pressable pressed styles (documented in the
// sidecar).

import React, {useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {Badge} from '../../../../components/ui/Badge';
import {DataTable, type Column} from '../../../../components/ui/DataTable';
import {TimeStamp} from '../../../../components/data-display/TimeStamp';
import {
  useFleetTelemetryErrorVINs,
  useFleetTelemetryErrors,
  useRefreshFleetTelemetryErrorVINs,
  useRefreshFleetTelemetryErrors,
  type FleetTelemetryErrorVIN,
  type FleetTelemetryError,
} from '../../../../api/hooks/useTelemetry';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// Toned-down SI body-text palette (web text-* classes have no className analog).
const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});
const CYAN_300 = '#67e8f9'; // text-cyan-300
const ROSE_300 = '#fda4af'; // text-rose-300
const AMBER_300 = '#fcd34d'; // text-amber-300
const INFO_CHIP_BG = '#1e3a8a'; // parity Badge info: dark:bg-blue-900
const INFO_CHIP_TEXT = '#bfdbfe'; // parity Badge info: dark:text-blue-200

/**
 * `isRecent` — true when `dateStr` is within the last 24h. Pure (depends only on
 * the argument + `Date.now()`); hoisted to module scope so the memoized column
 * builders below need no extra dependency, matching the web source's intent.
 */
function isRecent(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff < 24 * 60 * 60 * 1000;
}

// ── ToolCard (local chrome; sibling ./ToolCard not ported yet) ───────────────
type ToolTone = 'red' | 'amber';

interface ToolToneStyle {
  bg: string;
  border: string;
  fg: string;
}

// neon-{color}/10 bg + ring neon-{color}/20 + text neon-{color} -> the native
// danger/warning surface/border/foreground tokens.
const TOOL_TONES: Record<ToolTone, ToolToneStyle> = {
  red: {bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger},
  amber: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
};

interface ToolCardProps {
  /** Maps the web ToolCard `color` prop (red/amber here). */
  tone: ToolTone;
  /** Decorative glyph standing in for the lucide icon. */
  glyph: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function ToolCard({tone, glyph, title, description, children}: ToolCardProps) {
  const palette = TOOL_TONES[tone];
  return (
    <GlassPanel style={styles.toolCard}>
      <View style={styles.toolCardHeader}>
        <View
          style={[
            styles.toolCardIcon,
            {backgroundColor: palette.bg, borderColor: palette.border},
          ]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.toolCardGlyph, {color: palette.fg}]}>
            {glyph}
          </AppText>
        </View>
        <View style={styles.toolCardTitleWrap}>
          <AppText style={styles.toolCardTitle}>{title}</AppText>
          <AppText style={styles.toolCardDesc}>{description}</AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

// ── RefreshButton (web UiButton variant="secondary" size="sm" + RefreshCw) ───
interface RefreshButtonProps {
  label: string;
  loading: boolean;
  onPress: () => void;
}

function RefreshButton({label, loading, onPress}: RefreshButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: loading}}
      disabled={loading}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.refreshBtn,
        pressed && !loading ? styles.refreshBtnPressed : null,
        loading ? styles.refreshBtnDisabled : null,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.textSecondary} size="small" />
      ) : (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.refreshGlyph}>
          {'\u21bb'}
        </AppText>
      )}
      <AppText style={styles.refreshLabel}>{label}</AppText>
    </Pressable>
  );
}

// ── SkeletonBlock (web <Skeleton/> not ported; fixed-height placeholder) ─────
function SkeletonBlock({height}: {height: number}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, {height}]}
    />
  );
}

export function FleetTelemetryHealth() {
  const {t} = useTranslation();
  const [selectedVin, setSelectedVin] = useState('');

  const {data: errorVINs, isLoading: vinsLoading} = useFleetTelemetryErrorVINs();
  const {data: errors, isLoading: errorsLoading} = useFleetTelemetryErrors(
    selectedVin || undefined,
  );
  const refreshVINs = useRefreshFleetTelemetryErrorVINs();
  const refreshErrors = useRefreshFleetTelemetryErrors();

  const vinList = errorVINs ?? [];
  const errorList = errors ?? [];

  const vinColumns: Column<FleetTelemetryErrorVIN>[] = useMemo(
    () => [
      {
        key: 'vin',
        header: t('devtools.health.vin', 'VIN'),
        render: r => (
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            onPress={() =>
              setSelectedVin(r.vin === selectedVin ? '' : r.vin)
            }>
            <AppText style={styles.vinLink}>{r.vin}</AppText>
          </Pressable>
        ),
      },
      {
        key: 'first_seen_at',
        header: t('devtools.health.firstSeen', 'First Seen'),
        render: r => (
          <TimeStamp value={r.first_seen_at} style={styles.tsSecondary} />
        ),
      },
      {
        key: 'last_seen_at',
        header: t('devtools.health.lastSeen', 'Last Seen'),
        render: r => (
          <TimeStamp
            value={r.last_seen_at}
            style={[
              styles.tsBase,
              {color: isRecent(r.last_seen_at) ? ROSE_300 : AMBER_300},
            ]}
          />
        ),
      },
    ],
    [t, selectedVin],
  );

  const errorColumns: Column<FleetTelemetryError>[] = useMemo(
    () => [
      {
        key: 'vin',
        header: t('devtools.health.vin', 'VIN'),
        render: r => <AppText style={styles.vinMono}>{r.vin}</AppText>,
      },
      {
        key: 'error_code',
        header: t('devtools.health.errorCode', 'Error Code'),
        render: r =>
          r.error_code ? (
            <Badge variant="danger" size="sm">
              {r.error_code}
            </Badge>
          ) : (
            <AppText style={styles.mutedCell}>{'\u2014'}</AppText>
          ),
      },
      {
        key: 'error_message',
        header: t('devtools.health.message', 'Message'),
        render: r => (
          <AppText style={styles.secondaryCell}>
            {r.error_message ?? '\u2014'}
          </AppText>
        ),
      },
      {
        key: 'reported_at',
        header: t('devtools.health.reportedAt', 'Reported At'),
        render: r => (
          <TimeStamp
            value={r.reported_at}
            style={[
              styles.tsBase,
              {
                color:
                  r.reported_at && isRecent(r.reported_at)
                    ? ROSE_300
                    : colors.textSecondary,
              },
            ]}
          />
        ),
      },
    ],
    [t],
  );

  return (
    <View style={styles.container}>
      {/* Error VINs Summary */}
      <ToolCard
        tone="red"
        glyph={'\u26a0'}
        title={t('devtools.health.errorVinsTitle', 'Error VINs')}
        description={t(
          'devtools.health.errorVinsDesc',
          'Vehicles with fleet telemetry configuration errors',
        )}>
        <View style={styles.cardInner}>
          <View style={styles.headerRow}>
            <Badge variant={vinList.length > 0 ? 'danger' : 'success'} size="sm">
              {`${vinList.length} ${t(
                'devtools.health.affectedVehicles',
                'affected',
              )}`}
            </Badge>
            {selectedVin ? (
              <View style={styles.filterChip}>
                <AppText style={styles.filterChipText}>
                  {`${t('devtools.health.filteredBy', 'Filtered')}: ${selectedVin}`}
                </AppText>
                <Pressable
                  accessibilityLabel={t(
                    'devtools.health.clearVinFilter',
                    'Clear VIN filter',
                  )}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setSelectedVin('')}>
                  <AppText style={styles.filterChipClose}>{'\u00d7'}</AppText>
                </Pressable>
              </View>
            ) : null}
            <RefreshButton
              label={t('devtools.health.refreshVins', 'Refresh from Tesla')}
              loading={refreshVINs.isPending}
              onPress={() => refreshVINs.mutate()}
            />
          </View>
          {vinsLoading ? (
            <SkeletonBlock height={96} />
          ) : vinList.length > 0 ? (
            <DataTable
              tableId="admin:fleet-health-vins"
              columns={vinColumns}
              data={vinList}
              keyExtractor={r => r.vin}
              compact
            />
          ) : (
            <AppText style={styles.emptyText}>
              {t('devtools.health.noErrorVins', 'No vehicles with telemetry errors')}
            </AppText>
          )}
        </View>
      </ToolCard>

      {/* Error Log Table */}
      <ToolCard
        tone="amber"
        glyph="!"
        title={t('devtools.health.errorLogTitle', 'Error Log')}
        description={t(
          'devtools.health.errorLogDesc',
          'Detailed fleet telemetry error history',
        )}>
        <View style={styles.cardInner}>
          <View style={styles.headerRow}>
            <RefreshButton
              label={t('devtools.health.refreshErrors', 'Refresh from Tesla')}
              loading={refreshErrors.isPending}
              onPress={() => refreshErrors.mutate()}
            />
          </View>
          {errorsLoading ? (
            <SkeletonBlock height={160} />
          ) : errorList.length > 0 ? (
            <DataTable
              tableId="admin:fleet-health-errors"
              columns={errorColumns}
              data={errorList}
              keyExtractor={r => String(r.id)}
              compact
              pagination
            />
          ) : (
            <AppText style={styles.emptyText}>
              {t('devtools.health.noErrors', 'No fleet telemetry errors recorded')}
            </AppText>
          )}
        </View>
      </ToolCard>
    </View>
  );
}

export default FleetTelemetryHealth;

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg - 4, // space-y-4 (16)
    width: '100%',
  },
  toolCard: {
    padding: spacing.lg, // p-5 (20)
  },
  toolCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md, // gap-3 (12)
    marginBottom: spacing.md + 4, // mb-4 (16)
  },
  toolCardIcon: {
    alignItems: 'center',
    borderRadius: 8, // rounded-lg
    borderWidth: 1, // ring-1
    height: 40, // h-10
    justifyContent: 'center',
    width: 40, // w-10
  },
  toolCardGlyph: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  toolCardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  toolCardTitle: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    fontWeight: '600',
    lineHeight: 20,
  },
  toolCardDesc: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  cardInner: {
    gap: spacing.md, // space-y-3 (12)
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md, // gap-3 (12)
  },
  filterChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: INFO_CHIP_BG,
    borderRadius: 9999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8, // px-2
    paddingVertical: 2, // py-0.5
  },
  filterChipText: {
    color: INFO_CHIP_TEXT,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  filterChipClose: {
    color: INFO_CHIP_TEXT,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 16,
    paddingHorizontal: 2,
  },
  refreshBtn: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  refreshBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  refreshBtnDisabled: {
    opacity: 0.6,
  },
  refreshGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 16,
  },
  refreshLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    width: '100%',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
    paddingVertical: spacing.md + 4, // py-4 (16)
    textAlign: 'center',
  },
  vinLink: {
    color: CYAN_300,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  vinMono: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  mutedCell: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  secondaryCell: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  tsBase: {
    fontSize: 12,
    lineHeight: 16,
  },
  tsSecondary: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
});
