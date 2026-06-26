/**
 * TeslaApiUsageCard — operator-grade Tesla Fleet API spend & volume
 * detail card. (native parity port of
 * web/src/features/system/components/status/TeslaApiUsageCard.tsx)
 *
 * Combines the bare-bones `/system/api-usage` snapshot (this-month
 * total + cost) with the richer `/api-logs/stats` payload (last 24h
 * burn, avg latency, error rate, by-method and by-service splits)
 * to give the operator the answers they actually need:
 *   - Am I burning faster than the monthly credit allows?
 *   - When does the billing window reset?
 *   - What's eating the budget — which service / method?
 *   - Are recent calls healthy (latency, error rate)?
 *
 * The JSX skeleton (budget bar, bands, detail grid, top-lists,
 * banner, footer) is delegated to the shared native `<UsageCard>`
 * primitive in components/data-display so this card and AiUsageCard
 * share one visual contract. This file's sole job is to derive props
 * from the two API hooks.
 *
 * Native remap: lucide-react icons (Activity/TrendingUp/Zap/Clock,
 * web L22) have no native renderer, so each small inline `h-3.5 w-3.5`
 * icon becomes a monochrome AppText glyph tinted to the muted label
 * colour (the LiveStatusPill / AutomationActivityFeed inline-glyph
 * precedent). `@/hooks/useFormatting` formatCurrency (web L24) is
 * rebuilt from the native useFormatPrefs() currencySymbol + locale
 * formatter; `@/lib/numberFormat` fmtInt/fmtPercent (web L34) become
 * fmt(v,0) / `${fmt(v,d)}%`, settings-driven exactly like the web
 * global-precision formatters. No DOM/HTML/Recharts/Leaflet imports.
 */

import {useMemo} from 'react';
import {StyleSheet} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import {useApiLogStats} from '../../../../api/hooks/useAdmin';
import type {APIUsage} from '../../../../api/types';
import {
  UsageCard,
  type UsageCardBand,
  type UsageCardDetail,
  type UsageCardIntent,
  type UsageCardTopList,
  type UsageCardTopListItem,
} from '../../../../components/data-display';
import {useFormatPrefs} from '../../../../components/data-display/format/_formatPrimitives';

interface TeslaApiUsageCardProps {
  apiUsage: APIUsage | undefined;
  /** "now" passed in so the page-level tick re-renders the countdown. */
  now: number;
}

function startOfMonth(now: number): Date {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(now: number): Date {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

// camelCaseKeys() in the native parity client (api/client.ts) mirrors snake_case
// JSON to BOTH snake_case and camelCase keys (recursively, including inside
// maps), exactly like the web lib/resilience helper. For grouped breakdowns like
// by_service we therefore see e.g. { tesla_fleet: 28000, teslaFleet: 28000 } — we
// collapse the camelCase clones so the UI doesn't render duplicate rows.
function dedupeMap(
  m: Record<string, number> | undefined,
): Array<[string, number]> {
  if (!m) return [];
  const entries = Object.entries(m);
  const snakeKeys = entries.filter(([k]) => k.includes('_')).map(([k]) => k);
  const aliases = new Set(
    snakeKeys.map(sk =>
      sk.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
    ),
  );
  const out: Array<[string, number]> = [];
  const seen = new Set<string>();
  for (const [k, v] of entries) {
    if (aliases.has(k) && !k.includes('_')) continue;
    const norm = k.toLowerCase().replace(/_/g, '');
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push([k, v]);
  }
  return out;
}

// Small inline icon glyphs (web lucide Activity/Clock/TrendingUp/Zap rendered at
// h-3.5 w-3.5). Monochrome marks so they read inside UsageCard's 14x14 icon slot
// without pulling in a DOM SVG icon library.
const ICON_GLYPH = {
  activity: '◉',
  clock: '◷',
  trendingUp: '↗',
  zap: '↯',
} as const;

function InlineGlyph({glyph}: {glyph: string}) {
  return (
    <AppText style={styles.glyph} tone="muted" variant="caption">
      {glyph}
    </AppText>
  );
}

// Web band value `<>{count} <span class="text-xs text-muted">requests</span></>`
// — a prominent count with a smaller muted unit suffix, rendered inline via
// nested RN <Text>.
function CountWithUnit({count, unit}: {count: string; unit: string}) {
  return (
    <AppText tone="primary" variant="caption" weight="semibold">
      {count}{' '}
      <AppText style={styles.unitSuffix} tone="muted" variant="caption">
        {unit}
      </AppText>
    </AppText>
  );
}

// Mirror of UsageCard's internal VALUE_TEXT intent→colour map, applied locally so
// the composite Error-rate detail value keeps its intent colour (UsageCard only
// colours plain string/number detail values, not element nodes).
const DETAIL_VALUE_COLOR: Record<UsageCardIntent, string> = {
  normal: colors.textPrimary,
  warn: '#fcd34d',
  danger: '#f87171',
};

export function TeslaApiUsageCard({apiUsage, now}: TeslaApiUsageCardProps) {
  const {data: logStats} = useApiLogStats();
  const {currencySymbol, fmt} = useFormatPrefs();

  // formatCurrency / fmtInt / fmtPercent ported from web useFormatting +
  // numberFormat onto the settings-driven, locale-aware native formatter.
  const formatCurrency = (amount: number, decimals?: number): string =>
    `${currencySymbol}${fmt(amount, decimals)}`;
  const fmtPercent = (v: unknown, decimals?: number): string =>
    `${fmt(v, decimals)}%`;
  const fmtCount = (n: number): string =>
    Number.isFinite(n) ? fmt(n, 0) : '—';

  const derived = useMemo(() => {
    if (!apiUsage) return null;

    const monthStart = startOfMonth(now).getTime();
    const monthEnd = endOfMonth(now).getTime();
    const totalDaysInMonth = Math.ceil(
      (monthEnd - monthStart) / (24 * 60 * 60 * 1000),
    );
    const daysElapsed = Math.max(
      1,
      Math.ceil((now - monthStart) / (24 * 60 * 60 * 1000)),
    );
    const daysRemaining = Math.max(0, totalDaysInMonth - daysElapsed);

    const pctOfBudget =
      apiUsage.monthly_credit > 0
        ? (apiUsage.estimated_cost / apiUsage.monthly_credit) * 100
        : 0;

    const dailyAvgCost = apiUsage.estimated_cost / daysElapsed;
    const dailyAvgRequests = apiUsage.total_requests / daysElapsed;

    // Forecast end-of-month using two methods:
    //   - Linear extrapolation of month-to-date average
    //   - Last 24h burn rate × full month
    const forecastFromMtd = dailyAvgCost * totalDaysInMonth;
    const last24hBurn = (logStats?.last24h ?? 0) * apiUsage.cost_per_request;
    const forecastFromRecent = last24hBurn * totalDaysInMonth;

    return {
      daysElapsed,
      daysRemaining,
      totalDaysInMonth,
      pctOfBudget,
      dailyAvgCost,
      dailyAvgRequests,
      forecastFromMtd,
      forecastFromRecent,
      last24hBurn,
    };
  }, [apiUsage, logStats, now]);

  if (!apiUsage || !derived) {
    return (
      <UsageCard emptyMessage="Tesla API usage data is not available yet." />
    );
  }

  const overBudget = apiUsage.estimated_cost > apiUsage.monthly_credit;
  const budgetIntent: UsageCardIntent = overBudget
    ? 'danger'
    : derived.pctOfBudget > 80
      ? 'warn'
      : 'normal';

  // Top 3 services by call count
  const topServices = dedupeMap(logStats?.by_service)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const methodEntries = dedupeMap(logStats?.by_method).sort(
    (a, b) => b[1] - a[1],
  );

  const usefulRequests = apiUsage.total_requests - apiUsage.skipped_polls;
  // Backend returns error_rate as a PERCENTAGE already (errorCount/total*100)
  const errorPct = logStats?.errorRate != null ? logStats.errorRate : null;

  const bands: UsageCardBand[] = [
    {
      icon: <InlineGlyph glyph={ICON_GLYPH.activity} />,
      label: 'This month',
      value: (
        <CountWithUnit
          count={fmtCount(apiUsage.total_requests)}
          unit="requests"
        />
      ),
      sub: `${formatCurrency(derived.dailyAvgCost)}/day avg`,
    },
    {
      icon: <InlineGlyph glyph={ICON_GLYPH.clock} />,
      label: 'Last 24h',
      value: (
        <CountWithUnit
          count={logStats?.last24h != null ? fmtCount(logStats.last24h) : '—'}
          unit="requests"
        />
      ),
      sub: `${formatCurrency(derived.last24hBurn)}/day burn`,
    },
    {
      icon: <InlineGlyph glyph={ICON_GLYPH.trendingUp} />,
      label: 'Forecast EOM',
      value: formatCurrency(derived.forecastFromMtd),
      sub: `recent rate: ${formatCurrency(derived.forecastFromRecent)}`,
      intent:
        derived.forecastFromMtd > apiUsage.monthly_credit ? 'danger' : 'normal',
    },
  ];

  const errorIntent: UsageCardIntent =
    errorPct != null && errorPct >= 5
      ? 'danger'
      : errorPct != null && errorPct >= 1
        ? 'warn'
        : 'normal';

  const details: UsageCardDetail[] = [
    {label: 'Useful', value: fmtCount(usefulRequests)},
    {label: 'Skipped (asleep)', value: fmtCount(apiUsage.skipped_polls)},
    {
      label: 'Avg latency',
      value:
        logStats?.avgDurationMs != null
          ? `${Math.round(logStats.avgDurationMs)} ms`
          : '—',
    },
    {
      label: 'Error rate',
      value:
        errorPct != null ? (
          <AppText
            style={{color: DETAIL_VALUE_COLOR[errorIntent]}}
            variant="caption">
            {fmtPercent(errorPct, 1)}
            {logStats?.errorCount != null ? (
              <AppText style={styles.countSuffix} tone="muted" variant="caption">
                {` (${fmtCount(logStats.errorCount)})`}
              </AppText>
            ) : null}
          </AppText>
        ) : (
          '—'
        ),
      intent: errorIntent,
    },
  ];

  const topLists: UsageCardTopList[] = [];
  if (topServices.length > 0) {
    topLists.push({
      key: 'services',
      icon: <InlineGlyph glyph={ICON_GLYPH.zap} />,
      title: 'Top services',
      items: topServices.map<UsageCardTopListItem>(([name, count]) => ({
        key: name,
        label: name,
        value: fmtCount(count),
      })),
    });
  }
  if (methodEntries.length > 0) {
    topLists.push({
      key: 'methods',
      icon: <InlineGlyph glyph={ICON_GLYPH.activity} />,
      title: 'By method',
      items: methodEntries.map<UsageCardTopListItem>(([method, count]) => ({
        key: method,
        label: method,
        value: fmtCount(count),
      })),
    });
  }

  return (
    <UsageCard
      bands={bands}
      banner={
        overBudget
          ? {
              title: 'Over monthly credit',
              description: `Spend has exceeded the ${formatCurrency(apiUsage.monthly_credit)} monthly credit by ${formatCurrency(apiUsage.estimated_cost - apiUsage.monthly_credit)}. Review polling cadence or vehicle subscriptions.`,
              intent: 'danger',
            }
          : undefined
      }
      budget={{
        headline: `${formatCurrency(apiUsage.estimated_cost)} of ${formatCurrency(apiUsage.monthly_credit)}`,
        rightLabel: `${fmtPercent(derived.pctOfBudget, 0)} of monthly credit`,
        caption: `Day ${derived.daysElapsed} of ${derived.totalDaysInMonth} ·${
          derived.daysRemaining === 0
            ? ' resets tomorrow'
            : ` resets in ${derived.daysRemaining} day${derived.daysRemaining === 1 ? '' : 's'}`
        }`,
        pct: derived.pctOfBudget,
        ariaLabel: 'Tesla API budget used',
        intent: budgetIntent,
      }}
      details={details}
      footer={[
        {key: 'logs', to: '/api-logs', label: 'Open API Logs', primary: true},
        {key: 'tesla', to: '/tesla-account', label: 'Tesla account'},
      ]}
      topLists={topLists}
    />
  );
}

const styles = StyleSheet.create({
  countSuffix: {
    fontWeight: '400',
  },
  glyph: {
    fontSize: 12,
    lineHeight: 14,
    textAlign: 'center',
  },
  unitSuffix: {
    fontSize: 10,
    fontWeight: '400',
  },
});

export default TeslaApiUsageCard;
