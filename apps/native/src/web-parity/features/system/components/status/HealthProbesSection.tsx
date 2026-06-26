// Native parity port of web/src/features/system/components/status/HealthProbesSection.tsx.
//
// `HealthProbesSection` polls `/system/health` every 30s and renders a collapsible
// accordion section with two side-by-side cards — Liveness (/healthz) and
// Readiness (/readyz) — each showing a status badge and a small key/value list.
// The TanStack Query wiring (queryKey, queryFn, refetchInterval), the
// `data?.… ?? fallback` null-safety, the i18n keys, and the loading/error/loaded
// render branches are all preserved 1:1.
//
// The web source pulls several browser/web-only or not-yet-ported modules; each
// is replaced with a native-safe equivalent per conversion rules 4/5/6/7 and
// recorded in the sidecar:
//   - react-i18next `useTranslation` (L1) -> the canonical native i18n shim
//     (the SleepEfficiencyPage precedent): i18next resolves a missing
//     translation to the fallback, else the key, so `t(key)` -> key and
//     `t(key, 'English')` -> 'English'. `{{token}}` interpolation is kept so the
//     404 branch reproduces the web copy exactly.
//   - `@tanstack/react-query` `useQuery` (L2) is a native dependency and is kept
//     verbatim.
//   - lucide-react `HeartPulse` SVG (L3, react-native-svg is not a dependency)
//     -> a decorative "\u2665" AppText glyph tinted with the cyan accent (the web
//     wrapper's `text-cyan-400`), flagged aria-hidden (AccordionSection /
//     HealthRow glyph precedent).
//   - `@/components/layout` `Grid` (L4) -> a native-safe flex Grid; the
//     `{ default: 1, md: 2 }` responsive intent is reproduced with a
//     wrap+flexGrow row whose 240px item floor yields 1 column on phones and 2
//     on wide screens. `@/lib/cn` Tailwind merging has no native analog.
//   - `@/components/ui` `Badge` (L5) is the genuinely-ported native web-parity
//     Badge (variant/size/dot/children match). `Card` + `CardHeader` are not
//     ported yet, so native-safe equivalents are inlined here (a flat rounded
//     surface card and a title/action header) — the same per-consumer inlining
//     the methodology uses for numberFormat / the i18n shim.
//   - `@/components/data-display` `KVList` (L6) -> an inlined native KVList: a
//     column of label/value rows with a top divider between rows (web
//     `divide-y`).
//   - `@/components/feedback` `Skeleton` + `QueryError` (L7) -> inlined
//     native-safe equivalents. Skeleton is a muted sized block (the infinite
//     `animate-pulse` is a web-only CSS animation, dropped like other
//     transitions). QueryError's status-branching copy + i18n keys are kept for
//     401/403, 404, 5xx, and the network fallback; its router/`useOnlineStatus`/
//     `window 'online'` auto-retry-on-reconnect and the transient-waiting branch
//     are browser-only and collapse into a manual Retry (documented below).
//   - `@/lib/numberFormat` `fmtNumber` / `fmtInt` (L8) -> inlined locale-aware
//     formatters (the SleepEfficiencyPage precedent).
//   - `@/api/devtools` `getExtendedHealth` (L9) -> the native web-parity
//     devtools port (same `/system/health` request seam + ExtendedHealthResponse).
//   - `./AccordionSection` (L10) -> the native sibling port.
//   - `./helpers` `statusToBadgeVariant` / `formatUptime` (L11) -> inlined pure
//     functions (only these two of the helpers module are used here).
//
// No DOM modules, HTML elements, Recharts, Leaflet, or old web UI components are
// imported. StyleSheet keys/properties and JSX props are alphabetised for lint.

import React, { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '../../../../../components/ui/AppText';
import { colors, spacing } from '../../../../../theme/tokens';
import { getExtendedHealth } from '../../../../api/devtools';
import { Badge } from '../../../../components/ui/Badge';
import { AccordionSection } from './AccordionSection';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English'.
type TParams = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallback, params) =>
  interpolate(typeof fallback === 'string' ? fallback : key, params);

function useTranslation(): { t: TFunc } {
  return { t: translate };
}

/* ── numberFormat (inlined from web @/lib/numberFormat) ────────── */
// `safeNumber` collapses non-finite/non-number values to 0; `fmtNumber` is the
// locale-aware fixed-precision formatter (default precision 2); `fmtInt` is
// `fmtNumber(v, 0)`.
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

/* ── helpers (inlined from ./helpers) ──────────────────────────── */
type BadgeStatusVariant = 'success' | 'warning' | 'danger' | 'neutral';

function statusToBadgeVariant(status: string): BadgeStatusVariant {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'ready':
    case 'sent':
    case 'completed':
      return 'success';
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return 'warning';
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/* ── HeartPulse icon (lucide-react -> decorative glyph) ────────── */
function HeartPulseIcon(): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.heartIcon}
    >
      {'\u2665'}
    </AppText>
  );
}

/* ── Grid (inlined native-safe @/components/layout Grid) ───────── */
interface GridCols {
  default?: number;
  lg?: number;
  md?: number;
  sm?: number;
  xl?: number;
}

interface GridProps {
  children: ReactNode;
  cols?: GridCols;
  gap?: number;
}

function Grid({ children, cols = { default: 1 }, gap = 4 }: GridProps) {
  // Tailwind gap unit -> px (gap-4 -> 16). The widest requested breakpoint
  // decides whether items may sit side by side; a 240px floor then yields a
  // single column on phones and the requested columns on wide screens.
  const gapPx = gap * 4;
  const maxColumns = Math.max(
    cols.default ?? 1,
    cols.sm ?? 1,
    cols.md ?? 1,
    cols.lg ?? 1,
    cols.xl ?? 1,
  );
  const itemStyle =
    maxColumns <= 1 ? styles.gridItemFull : styles.gridItemFlexible;
  return (
    <View style={[styles.grid, { gap: gapPx }]}>
      {Children.map(children, child => (
        <View style={itemStyle}>{child}</View>
      ))}
    </View>
  );
}

/* ── Card + CardHeader (inlined native-safe @/components/ui) ────── */
function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

interface CardHeaderProps {
  action?: ReactNode;
  subtitle?: string;
  title: string;
}

function CardHeader({ action, subtitle, title }: CardHeaderProps) {
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderTitleWrap}>
        <AppText style={styles.cardHeaderTitle} weight="semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.cardHeaderSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/* ── KVList (inlined native-safe @/components/data-display) ─────── */
interface KVItem {
  label: string;
  value: ReactNode;
}

function renderValue(value: ReactNode): ReactNode {
  if (value == null || value === false) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return <AppText style={styles.kvValue}>{value}</AppText>;
  }
  return value;
}

function KVList({ items }: { items: KVItem[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[styles.kvRow, index > 0 ? styles.kvRowDivided : null]}
        >
          <AppText style={styles.kvLabel} tone="muted">
            {item.label}
          </AppText>
          {renderValue(item.value)}
        </View>
      ))}
    </View>
  );
}

/* ── Skeleton (inlined native-safe @/components/feedback) ───────── */
// The web `animate-pulse` is an infinite CSS animation with no native analog; the
// loading-placeholder intent (a muted block of the right size) is preserved while
// the pulse is dropped (like the AccordionSection transitions).
function Skeleton({ height = 16 }: { height?: number }) {
  return <View style={[styles.skeleton, { height }]} />;
}

/* ── QueryError (inlined native-safe @/components/feedback) ─────── */
// Reads `status` structurally (native ApiError carries a numeric `status`,
// mirroring the web `isApiError(error) ? error.status : undefined`) and keeps
// QueryError's status-branched copy + i18n keys. The router/useOnlineStatus/
// window 'online' auto-retry-on-reconnect and the transient-waiting branch are
// browser-only and collapse into the manual Retry below.
function errorStatus(error: unknown): number | undefined {
  if (error != null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

interface QueryErrorViewProps {
  error: unknown;
  onRetry?: () => void;
}

function QueryErrorView({ error, onRetry }: QueryErrorViewProps) {
  const { t } = useTranslation();
  const status = errorStatus(error);

  let title: string;
  let message: string;
  if (status === 401 || status === 403) {
    title = t('error.unauthorized.title', 'Sign in required');
    message = t(
      'error.unauthorized.message',
      'Your session has expired. Please sign in again.',
    );
  } else if (status === 404) {
    title = t('error.notFound.title', '{{thing}} not found', {
      thing: t('error.notFound.thingDefault', 'Resource'),
    });
    message = t(
      'error.notFound.message',
      'It may have been deleted or the link is wrong.',
    );
  } else if (status !== undefined && status >= 500) {
    title = t('error.serverError.title', 'Server error');
    message = t(
      'error.serverError.message',
      'Something went wrong on our end. Please try again.',
    );
  } else {
    title = t('error.network.title', "Can't reach server");
    message = t(
      'error.network.message',
      'Check your internet connection and try again.',
    );
  }

  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={styles.errorRoot}
    >
      <AppText style={styles.errorTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.errorMessage} tone="muted">
        {message}
      </AppText>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed ? styles.retryButtonPressed : null,
          ]}
        >
          <AppText style={styles.retryLabel}>
            {t('error.retry', 'Retry')}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function HealthProbesSection(): React.ReactElement {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <AccordionSection
        defaultOpen
        description={t('Liveness and readiness checks')}
        icon={<HeartPulseIcon />}
        title={t('Health Probes')}
      >
        <Grid cols={{ default: 1, md: 2 }} gap={4}>
          <Skeleton height={144} />
          <Skeleton height={144} />
        </Grid>
      </AccordionSection>
    );
  }

  if (error) {
    return (
      <AccordionSection
        defaultOpen
        description={t('Liveness and readiness checks')}
        icon={<HeartPulseIcon />}
        title={t('Health Probes')}
      >
        <QueryErrorView error={error} onRetry={() => refetch()} />
      </AccordionSection>
    );
  }

  const livenessStatus = data?.status ?? 'unknown';
  const dbStatus = data?.database?.status ?? 'unknown';
  const dbLatency = data?.database?.latency_ms;

  return (
    <AccordionSection
      badges={
        <>
          <Badge dot size="sm" variant={statusToBadgeVariant(livenessStatus)}>
            {t('Live')}
          </Badge>
          <Badge dot size="sm" variant={statusToBadgeVariant(dbStatus)}>
            {t('Ready')}
          </Badge>
        </>
      }
      defaultOpen
      description={t('Liveness and readiness checks')}
      icon={<HeartPulseIcon />}
      title={t('Health Probes')}
    >
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader
            action={
              <Badge size="sm" variant={statusToBadgeVariant(livenessStatus)}>
                {livenessStatus}
              </Badge>
            }
            title={t('Liveness \u2014 /healthz')}
          />
          <KVList
            items={[
              { label: t('Status'), value: livenessStatus },
              {
                label: t('Goroutines'),
                value: fmtInt(data?.system?.goroutines ?? 0),
              },
              {
                label: t('Uptime'),
                value: formatUptime(data?.system?.uptime_seconds ?? 0),
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            action={
              <Badge size="sm" variant={statusToBadgeVariant(dbStatus)}>
                {dbStatus}
              </Badge>
            }
            title={t('Readiness \u2014 /readyz')}
          />
          <KVList
            items={[
              { label: t('Database'), value: dbStatus },
              {
                label: t('Latency'),
                value:
                  dbLatency != null
                    ? `${fmtNumber(dbLatency, 1)} ms`
                    : '\u2014',
              },
              {
                label: t('Pool Connections'),
                value: fmtInt(data?.database_pool?.total_conns ?? 0),
              },
            ]}
          />
        </Card>
      </Grid>
    </AccordionSection>
  );
}

HealthProbesSection.displayName = 'HealthProbesSection';

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 2,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardHeaderSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  cardHeaderTitle: {
    fontSize: 16,
    lineHeight: 24,
  },
  cardHeaderTitleWrap: {
    flexShrink: 1,
  },
  errorMessage: {
    textAlign: 'center',
  },
  errorRoot: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  errorTitle: {
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItemFlexible: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 240,
  },
  gridItemFull: {
    width: '100%',
  },
  heartIcon: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 20,
  },
  kvLabel: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  kvRowDivided: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  kvValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'right',
  },
  retryButton: {
    alignSelf: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    width: '100%',
  },
});

export default HealthProbesSection;
