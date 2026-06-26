/**
 * InfrastructureSection — React Native parity port of
 * web/src/features/system/components/status/InfrastructureSection.tsx.
 *
 * Renders the System Status "Infrastructure" accordion: a live SSE-connection
 * card + a polling-engine card (two-up on the web's md grid, stacked on a
 * phone) plus, when the extended-health probe returns a database pool, a
 * three-up row of connection-pool metrics. Behaviour preserved 1:1 from the
 * source:
 *   - Two TanStack Query reads keyed exactly as the web file
 *     (['system-status','telemetry'] @ refetchInterval 2_000 and
 *     ['system-status','extended-health'] @ refetchInterval 30_000) backed by
 *     the already-ported native getTelemetryStatus / getExtendedHealth.
 *   - `sseConnected = telemetry?.enabled ?? false` and
 *     `connectionMode = telemetry?.mode ?? 'unknown'` drive every badge,
 *     status icon, and the SSE/polling KV rows, with the same null fallbacks
 *     (`?? '—'`, `Yes — Polling` / `No`, `Active` / `Standby`).
 *   - The DB-pool row only renders when `extHealth?.database_pool` is present,
 *     and its three values are run through `fmtInt` exactly as the web file.
 *
 * Browser-only / not-yet-ported web dependencies are reduced explicitly and
 * documented in the .parity.json sidecar:
 *   - react-i18next `useTranslation` (web L1): replaced by a native-safe
 *     `t(key, fallback?, params?)` shim that interpolates i18next-style
 *     `{{label}}` placeholders. Every translation key is preserved verbatim
 *     (the web file passes the English copy as the key, so the key IS the
 *     fallback), keeping i18n intent intact — the established sibling-port
 *     convention (SignalQueryControls / YearlyTrendChart).
 *   - `@tanstack/react-query` `useQuery` (web L2): kept verbatim — TanStack
 *     Query runs unchanged on React Native.
 *   - lucide-react Globe / Wifi / WifiOff / Database / Activity / Clock
 *     (web L3) + the AccordionSection ChevronDown: rendered as decorative
 *     colour-inheriting `AppText` glyphs (🌐 / ● / ✕ / 🗄 / 📈 / 🕐 / ⌄), the
 *     same approach the sibling ports use; the implicit aria-hidden becomes
 *     importantForAccessibility="no-hide-descendants".
 *   - `@/components/layout` Grid (web L4), `@/components/ui` Badge / Card /
 *     CardHeader (web L5), `@/components/data-display` InlineMetric / KVList
 *     (web L6), and the sibling `./AccordionSection` (web L9): no native parity
 *     port exists yet, so minimal native-safe equivalents are reproduced
 *     locally (the SignalQueryControls "reproduce the dependency locally"
 *     precedent). Grid's responsive `cols={{ default, md }}` collapses to its
 *     mobile-first `default` count (1 on a phone for the SSE/polling pair,
 *     3 for the metric row). AccordionSection's DOM role="button"/tabIndex/
 *     onKeyDown Enter-Space handler becomes a Pressable with
 *     accessibilityRole="button" + accessibilityState.expanded; its
 *     framer-driven FadeIn body reveal has no inert RN analog and collapses to
 *     a plain conditional mount (the open/closed state is unchanged).
 *   - `@/lib/numberFormat` `fmtInt` (web L7): reproduced locally as the
 *     0-decimal en-US `toLocaleString` (the XRayFieldsTable precedent;
 *     fmtInt === fmtNumber(v, 0) with the global locale defaulting to en-US).
 *   - `@/api/devtools` getTelemetryStatus / getExtendedHealth (web L8):
 *     imported from the already-ported native devtools module.
 */

import {
  Children,
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {getExtendedHealth, getTelemetryStatus} from '../../../../api/devtools';

/* ── lucide-react glyph stand-ins (web L3 + AccordionSection ChevronDown) ── */
const GLOBE_GLYPH = '\uD83C\uDF10'; // 🌐 Globe
const WIFI_GLYPH = '\u25CF'; // ● Wifi
const WIFI_OFF_GLYPH = '\u2715'; // ✕ WifiOff
const DATABASE_GLYPH = '\uD83D\uDDC4'; // 🗄 Database
const ACTIVITY_GLYPH = '\uD83D\uDCC8'; // 📈 Activity
const CLOCK_GLYPH = '\uD83D\uDD50'; // 🕐 Clock
const CHEVRON_DOWN_GLYPH = '\u2304'; // ⌄ ChevronDown

/* ── native-safe useTranslation (web @/react-i18next, source L1) ── */
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

/* ── fmtInt (native-safe port of `@/lib/numberFormat` fmtInt, web L7) ── */
/** Format as integer with locale separators: fmtInt(12345.6) -> "12,346". */
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* ── Grid (native-safe port of `@/components/layout` Grid, web L4) ── */
interface GridCols {
  default?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

interface GridProps {
  cols?: GridCols;
  /** Tailwind gap scale (1 unit = 0.25rem = 4px), matching the web prop. */
  gap?: number;
  children: ReactNode;
}

/**
 * Phone-first grid: the web `cols` map is resolved to its mobile-first
 * `default` breakpoint (a phone is the smallest viewport, so the SSE/polling
 * pair stacks and the metric row keeps its 3 columns). Columns are laid out
 * with a half-gutter negative-margin pattern so inter-cell gaps stay symmetric
 * and the outer edges stay flush.
 */
function Grid({cols = {default: 1}, gap = 4, children}: GridProps) {
  const columns = Math.max(1, cols.default ?? 1);
  const gapPx = gap * 4;
  const items = Children.toArray(children) as ReactElement[];

  if (columns === 1) {
    const stackStyle: ViewStyle = {rowGap: gapPx};
    return <View style={stackStyle}>{items}</View>;
  }

  const half = gapPx / 2;
  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -half,
  };
  const cellStyle: ViewStyle = {
    width: `${100 / columns}%` as ViewStyle['width'],
    paddingHorizontal: half,
    marginBottom: gapPx,
  };
  return (
    <View style={rowStyle}>
      {items.map((child, i) => (
        <View key={child.key ?? i} style={cellStyle}>
          {child}
        </View>
      ))}
    </View>
  );
}

/* ── Badge (native-safe port of `@/components/ui` Badge, web L5) ── */
type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
}

function Badge({variant = 'neutral', size = 'md', dot, children}: BadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' ? styles.badgeSm : styles.badgeMd,
        badgeBgStyles[variant],
      ]}>
      {dot ? <View style={[styles.badgeDot, badgeDotStyles[variant]]} /> : null}
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ── Card / CardHeader (native-safe port of `@/components/ui` Card, web L5) ── */
function Card({children}: {children: ReactNode}) {
  return <View style={styles.card}>{children}</View>;
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

function CardHeader({title, subtitle, action}: CardHeaderProps) {
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderTextWrap}>
        <AppText style={styles.cardHeaderTitle} weight="semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.cardHeaderSubtitle}>{subtitle}</AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/* ── KVList (native-safe port of `@/components/data-display` KVList, web L6) ── */
interface KVItem {
  label: string;
  value: ReactNode;
}

function KVList({items}: {items: KVItem[]}) {
  return (
    <View>
      {items.map((item, i) => (
        <View
          key={item.label}
          style={[styles.kvRow, i > 0 ? styles.kvRowDivider : null]}>
          <AppText style={styles.kvLabel}>{item.label}</AppText>
          <View style={styles.kvValueWrap}>
            {typeof item.value === 'string' || typeof item.value === 'number' ? (
              <AppText style={styles.kvValueText} weight="semibold">
                {item.value}
              </AppText>
            ) : (
              item.value
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ── InlineMetric (port of `@/components/data-display` InlineMetric, web L6) ── */
interface InlineMetricProps {
  icon: ReactNode;
  value: string | number;
  label?: string;
}

function InlineMetric({icon, value, label}: InlineMetricProps) {
  return (
    <View style={styles.inlineMetric}>
      <View style={styles.inlineMetricIconWrap}>{icon}</View>
      <AppText style={styles.inlineMetricValue}>{value}</AppText>
      {label ? (
        <AppText style={styles.inlineMetricLabel}>{label}</AppText>
      ) : null}
    </View>
  );
}

/* ── AccordionSection (native-safe port of `./AccordionSection`, web L9) ── */
interface AccordionSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const handleToggle = useCallback(() => setOpen(prev => !prev), []);

  return (
    <GlassPanel style={styles.accordion}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={handleToggle}
        style={({pressed}) => [
          styles.accordionHeader,
          pressed ? styles.accordionHeaderPressed : null,
        ]}
        testID="infrastructure-accordion-header">
        <View style={styles.accordionIconWrap}>{icon}</View>
        <View style={styles.accordionTitleWrap}>
          <AppText style={styles.accordionTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.accordionDescription}>{description}</AppText>
        </View>
        {badges ? <View style={styles.accordionBadges}>{badges}</View> : null}
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={[styles.accordionChevron, open ? styles.accordionChevronOpen : null]}>
          {CHEVRON_DOWN_GLYPH}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.accordionBody} testID="infrastructure-accordion-body">
          {children}
        </View>
      ) : null}
    </GlassPanel>
  );
}

export function InfrastructureSection() {
  const t = useNativeTranslation();

  const {data: telemetry} = useQuery({
    queryKey: ['system-status', 'telemetry'],
    queryFn: getTelemetryStatus,
    refetchInterval: 2_000,
  });

  const {data: extHealth} = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  const sseConnected = telemetry?.enabled ?? false;
  const connectionMode = telemetry?.mode ?? 'unknown';

  return (
    <AccordionSection
      icon={
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={styles.headerIcon}>
          {GLOBE_GLYPH}
        </AppText>
      }
      title={t('Infrastructure')}
      description={t('SSE connections and polling engine diagnostics')}
      badges={
        <Badge variant={sseConnected ? 'success' : 'warning'} size="sm" dot>
          {sseConnected ? t('Connected') : t('Disconnected')}
        </Badge>
      }>
      <Grid cols={{default: 1, md: 2}} gap={4}>
        <Card>
          <CardHeader
            title={t('SSE Connection')}
            action={
              sseConnected ? (
                <AppText
                  importantForAccessibility="no-hide-descendants"
                  style={styles.iconWifiOn}>
                  {WIFI_GLYPH}
                </AppText>
              ) : (
                <AppText
                  importantForAccessibility="no-hide-descendants"
                  style={styles.iconWifiOff}>
                  {WIFI_OFF_GLYPH}
                </AppText>
              )
            }
          />
          <KVList
            items={[
              {
                label: t('Connection State'),
                value: (
                  <Badge variant={sseConnected ? 'success' : 'danger'} size="sm">
                    {sseConnected ? t('Connected') : t('Disconnected')}
                  </Badge>
                ),
              },
              {label: t('Endpoint'), value: telemetry?.endpoint ?? '—'},
              {label: t('Protocol'), value: telemetry?.protocol ?? '—'},
              {
                label: t('Fallback Mode'),
                value:
                  connectionMode === 'polling' ? t('Yes — Polling') : t('No'),
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            title={t('Polling Engine')}
            action={
              <Badge
                variant={connectionMode === 'polling' ? 'success' : 'neutral'}
                size="sm">
                {connectionMode === 'polling' ? t('Active') : t('Standby')}
              </Badge>
            }
          />
          <KVList
            items={[
              {label: t('Mode'), value: connectionMode},
              {
                label: t('Speed Comparison'),
                value: telemetry?.speed_comparison?.speedup ?? '—',
              },
              {
                label: t('Fleet Telemetry Latency'),
                value:
                  telemetry?.speed_comparison?.fleet_telemetry_latency ?? '—',
              },
              {
                label: t('Fleet API Polling'),
                value: telemetry?.speed_comparison?.fleet_api_polling ?? '—',
              },
            ]}
          />
        </Card>
      </Grid>

      {extHealth?.database_pool ? (
        <View style={styles.poolWrap}>
          <Grid cols={{default: 3}} gap={3}>
            <InlineMetric
              icon={<AppText style={styles.iconCyan}>{DATABASE_GLYPH}</AppText>}
              value={fmtInt(extHealth.database_pool.total_conns)}
              label={t('Total Conns')}
            />
            <InlineMetric
              icon={<AppText style={styles.iconGreen}>{ACTIVITY_GLYPH}</AppText>}
              value={fmtInt(extHealth.database_pool.acquired_conns)}
              label={t('Acquired')}
            />
            <InlineMetric
              icon={<AppText style={styles.iconAmber}>{CLOCK_GLYPH}</AppText>}
              value={fmtInt(extHealth.database_pool.idle_conns)}
              label={t('Idle')}
            />
          </Grid>
        </View>
      ) : null}
    </AccordionSection>
  );
}

const HAIRLINE = 'rgba(255, 255, 255, 0.06)'; // border-white/[0.06]
const HEADER_PRESSED = 'rgba(255, 255, 255, 0.02)'; // hover:bg-white/[0.02]

const styles = StyleSheet.create({
  accordion: {
    overflow: 'hidden',
  },
  accordionHeader: {
    alignItems: 'center',
    columnGap: spacing.md, // gap-3 (12px)
    flexDirection: 'row',
    paddingHorizontal: spacing.lg, // px-5 (20px)
    paddingVertical: 16, // py-4
  },
  accordionHeaderPressed: {
    backgroundColor: HEADER_PRESSED,
  },
  accordionIconWrap: {
    flexShrink: 0,
  },
  accordionTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  accordionTitle: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
  },
  accordionDescription: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
    marginTop: 2, // mt-0.5
  },
  accordionBadges: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2 (8px)
    flexDirection: 'row',
    flexShrink: 0,
  },
  accordionChevron: {
    color: colors.textMuted,
    fontSize: 16, // h-4 w-4
  },
  accordionChevronOpen: {
    transform: [{rotate: '180deg'}], // rotate-180
  },
  accordionBody: {
    borderTopColor: HAIRLINE,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg, // px-5
    paddingVertical: 16, // py-4
    rowGap: 16, // space-y-4
  },
  headerIcon: {
    color: colors.accent, // text-cyan-400
    fontSize: 18, // h-5 w-5
  },
  iconWifiOn: {
    color: colors.success, // text-green-400
    fontSize: 15, // h-4 w-4
  },
  iconWifiOff: {
    color: colors.danger, // text-red-400
    fontSize: 15,
  },
  card: {
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 12, // rounded-lg
    borderWidth: 1,
    padding: 16, // p-4
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16, // mb-4
  },
  cardHeaderTextWrap: {
    flexShrink: 1,
  },
  cardHeaderTitle: {
    color: colors.textPrimary,
    fontSize: 16, // text-base
  },
  cardHeaderSubtitle: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
  },
  kvRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm, // py-2
  },
  kvRowDivider: {
    borderTopColor: colors.border, // divide-y
    borderTopWidth: 1,
  },
  kvLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    flexShrink: 1,
    fontSize: 14, // text-sm
  },
  kvValueWrap: {
    alignItems: 'flex-end',
    flexShrink: 1,
  },
  kvValueText: {
    color: colors.textPrimary, // text-gray-100
    fontSize: 14, // text-sm font-medium
    textAlign: 'right',
  },
  inlineMetric: {
    alignItems: 'center',
    columnGap: spacing.xs, // gap-1
    flexDirection: 'row',
  },
  inlineMetricIconWrap: {
    flexShrink: 0,
  },
  inlineMetricValue: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
  },
  inlineMetricLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12,
  },
  iconCyan: {
    color: colors.accent, // text-cyan-400
    fontSize: 12, // [&>svg]:h-3 w-3
  },
  iconGreen: {
    color: colors.success, // text-green-400
    fontSize: 12,
  },
  iconAmber: {
    color: colors.warning, // text-amber-400
    fontSize: 12,
  },
  poolWrap: {
    // mt-4 is realized by the accordion body's space-y-4 rowGap.
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999, // rounded-full
    columnGap: spacing.xs, // gap-1
    flexDirection: 'row',
  },
  badgeSm: {
    paddingHorizontal: 6, // px-1.5
    paddingVertical: 2, // py-0.5
  },
  badgeMd: {
    paddingHorizontal: spacing.sm, // px-2
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12, // text-xs
  },
  badgeDot: {
    borderRadius: 3,
    height: 6, // h-1.5
    width: 6, // w-1.5
  },
});

const badgeBgStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {backgroundColor: colors.accentSoft},
  success: {backgroundColor: colors.successSurface},
  warning: {backgroundColor: colors.warningSurface},
  danger: {backgroundColor: colors.dangerSurface},
  neutral: {backgroundColor: colors.surfaceRaised},
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {color: colors.accent},
  success: {color: colors.success},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
  neutral: {color: colors.textSecondary},
});

const badgeDotStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {backgroundColor: colors.accent},
  success: {backgroundColor: colors.success},
  warning: {backgroundColor: colors.warning},
  danger: {backgroundColor: colors.danger},
  neutral: {backgroundColor: colors.textSecondary},
});
