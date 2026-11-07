import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicleSubscriptions, useVehicles } from '@/api/hooks/useVehicles';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

/** Safely extract a string from an unknown value */
export function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return null;
}

/** Compute days until an expiry date string */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  const now = new Date();
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Known subscription types to extract from the data envelope */
const SUBSCRIPTION_TYPES = [
  { key: 'premium_connectivity', labelKey: 'widget.subscriptions.premiumConnectivity', fallback: 'Premium Connectivity' },
  { key: 'full_self_driving', labelKey: 'widget.subscriptions.fsd', fallback: 'Full Self-Driving' },
  { key: 'enhanced_autopilot', labelKey: 'widget.subscriptions.enhancedAutopilot', fallback: 'Enhanced Autopilot' },
  { key: 'standard_connectivity', labelKey: 'widget.subscriptions.standardConnectivity', fallback: 'Standard Connectivity' },
  { key: 'data_sharing', labelKey: 'widget.subscriptions.dataSharing', fallback: 'Data sharing' },
  { key: 'satellite_connectivity', labelKey: 'widget.subscriptions.satellite', fallback: 'Satellite connectivity' },
] as const;

export interface ParsedSub {
  name: string;
  active: boolean | null;
  expiryDate: string | null;
  renewalType: string | null;
  daysLeft: number | null;
  price: number | null;
  billingPeriod: string | null;
}

function knownNumber(val: unknown): number | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function subscriptionStatus(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const status = asString(value)?.trim().toLowerCase();
  if (status && ['active', 'included', 'enabled', 'subscribed', 'trial', 'true', '1'].includes(status)) return true;
  if (status && ['expired', 'inactive', 'cancelled', 'canceled', 'disabled', 'false', '0'].includes(status)) return false;
  return null;
}

export function parseSubscriptions(
  data: Record<string, unknown> | null | undefined,
  t: (k: string, f: string) => string,
): ParsedSub[] {
  if (!data) return [];
  const subs: ParsedSub[] = [];

  for (const sub of SUBSCRIPTION_TYPES) {
    const val = data[sub.key];
    if (val == null || val === false || val === '') continue;

    const expiryDate = asString(
      (data as Record<string, unknown>)[`${sub.key}_expiry_date`]
      ?? (data as Record<string, unknown>)[`${sub.key}_expiry`],
    );
    const days = daysUntil(expiryDate);
    const active = expiryDate
      ? days == null ? null : days > 0
      : subscriptionStatus(val);

    const renewalRaw = asString(
      (data as Record<string, unknown>)[`${sub.key}_renewal`]
      ?? (data as Record<string, unknown>)[`${sub.key}_renewal_type`],
    );

    subs.push({
      name: t(sub.labelKey, sub.fallback),
      active,
      expiryDate,
      renewalType: renewalRaw,
      daysLeft: days,
      price: knownNumber(data[`${sub.key}_price`] ?? data[`${sub.key}_monthly_price`] ?? data[`${sub.key}_amount`]),
      billingPeriod: asString(data[`${sub.key}_billing_period`] ?? data[`${sub.key}_period`]),
    });
  }

  // Fallback: handle any generic subscriptions array in the data
  const subscriptions = data.subscriptions;
  if (Array.isArray(subscriptions)) {
    for (const item of subscriptions) {
      if (item == null || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const name = asString(rec.name) ?? asString(rec.type) ?? t('widget.subscriptions.unknown', 'Unknown');
      const expiryDate = asString(rec.expiry_date) ?? asString(rec.expiry) ?? asString(rec.end_date);
      const days = daysUntil(expiryDate);
      const status = asString(rec.status);
      const active = status
        ? subscriptionStatus(status)
        : days != null ? days > 0 : null;

      // Avoid duplicates from known types
      if (subs.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;

      subs.push({
        name,
        active,
        expiryDate,
        renewalType: asString(rec.renewal_type) ?? asString(rec.renewal),
        daysLeft: days,
        price: knownNumber(rec.price) ?? knownNumber(rec.monthly_price) ?? knownNumber(rec.amount),
        billingPeriod: asString(rec.billing_period) ?? asString(rec.period) ?? null,
      });
    }
  }

  return subs;
}

export default function SubscriptionsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtInt } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const numericId = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const stringId = Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : undefined;
  const { formatDateShort } = useDateFormat();

  const subscriptionsQuery = useVehicleSubscriptions(stringId);
  const {
    data: envelope,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = subscriptionsQuery;
  const subscriptionsState = useDataState(subscriptionsQuery, {
    partial: envelope !== undefined && envelope?.data == null,
  });
  const vehiclesState = useDataState(vehiclesQuery);

  const subsData = envelope?.data ?? null;
  const emptyMessage = subsData == null
    ? t('widget.emptyMessage', 'This widget has no qualifying data yet.')
    : t('widget.subscriptions.noData', 'No subscriptions');
  const isCompact = size.cols <= 1;

  const parsed = useMemo(() => parseSubscriptions(subsData, t), [subsData, t]);

  const activeCount = useMemo(() => parsed.some((sub) => sub.active == null)
    ? null
    : parsed.filter((sub) => sub.active).length, [parsed]);

  const nextExpiry = useMemo(() => {
    const upcoming = parsed
      .filter((s) => s.active && s.daysLeft != null && s.daysLeft > 0)
      .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
    return upcoming[0] ?? null;
  }, [parsed]);

  const entries: DetailEntry[] = useMemo(() => {
    return parsed.map((sub) => {
      const renewalDate = sub.expiryDate && sub.daysLeft != null ? formatDateShort(sub.expiryDate) : null;
      const period = sub.billingPeriod?.toLowerCase() === 'month' || sub.billingPeriod?.toLowerCase() === 'monthly'
        ? t('widget.subscriptions.perMonth', '/mo')
        : sub.billingPeriod ? `/${sub.billingPeriod}` : null;

      return {
        label: sub.name,
        sublabel: renewalDate ?? sub.renewalType ?? undefined,
        value: sub.price != null ? formatCurrency(sub.price, 2) : '—',
        hint: period ?? undefined,
        status: sub.active ? 'success' as const : 'neutral' as const,
        badge: {
          text: sub.active == null
            ? t('widget.subscriptions.unknown', 'Unknown')
            : sub.active ? t('widget.subscriptions.active', 'Active') : t('widget.subscriptions.expired', 'Expired'),
          variant: sub.active ? 'success' as const : 'neutral' as const,
        },
      };
    });
  }, [parsed, t, formatDateShort, formatCurrency]);

  const monthlyTotal = useMemo(() => {
    const monthly = parsed.filter((sub) => sub.active && sub.price != null && (
      /month|monthly/i.test(sub.billingPeriod ?? '')
    ));
    return monthly.length > 0
      ? monthly.reduce((sum, sub) => sum + (sub.price ?? 0), 0)
      : null;
  }, [parsed]);

  const handleRefresh = useCallback(() => {
    if (!stringId) {
      void vehiclesQuery.refetch();
      return;
    }
    void refetch();
  }, [stringId, vehiclesQuery.refetch, refetch]);

  const shellProps = {
    title: t('widget.subscriptions.title', 'Subscriptions'),
    loading: isLoading,
    dataState: stringId ? subscriptionsState : vehiclesState,
    updatedAt: (stringId ? dataUpdatedAt : vehiclesQuery.dataUpdatedAt) ?? 0,
    isFetching: stringId ? isFetching : vehiclesQuery.isFetching,
    isStale: stringId ? isStale : vehiclesQuery.isStale,
    isError: stringId ? isError : vehiclesQuery.isError,
    onRefresh: handleRefresh,
  };

  const headline = parsed.length > 0 ? (
    <WidgetBigNumber
      value={activeCount == null ? null : fmtInt(activeCount)}
      label={t('widget.subscriptions.activeCount', 'active')}
      align={isCompact ? 'center' : 'start'}
      size="secondary"
    />
  ) : undefined;
  const expiryBadge = nextExpiry ? (
    <Badge
      variant="neutral"
      size="sm"
      className="min-h-[44px] min-w-[44px] max-w-full whitespace-normal break-words text-center"
    >
      {formatDateShort(nextExpiry.expiryDate) ?? '—'}
    </Badge>
  ) : undefined;
  const empty = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<CreditCard className="h-5 w-5" />}
      message={emptyMessage}
      className="py-2"
    />
  );
  const detailList = (
    <WidgetDetailCard
      entries={entries}
      compact={isCompact}
      emptyMessage={emptyMessage}
      emptyIcon={<CreditCard className="h-5 w-5" />}
    />
  );

  // ── Compact layout (1×2): active count + next expiry ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <InstrumentPresentation family="list" compact headline={headline}
          icon={parsed.length > 0 ? <CreditCard /> : undefined}
          details={parsed.length > 0 ? expiryBadge : empty}>
          <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
            {parsed.length > 0 ? (
              <>
                <CreditCard className="h-4 w-4 text-theme-accent" />
                {headline}
                {expiryBadge}
              </>
            ) : empty}
          </div>
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×4): full subscription list ──
  return (
    <WidgetShell
      icon={<CreditCard className="h-3.5 w-3.5 text-theme-accent" />}
      {...shellProps}
      footer={parsed.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Caption className="min-w-0 tabular-nums">
            {monthlyTotal == null
              ? activeCount == null
                ? t('widget.subscriptions.unknown', 'Unknown')
                : t('widget.subscriptions.activeSummary', '{{count}} active', { count: activeCount })
              : t('widget.subscriptions.monthlySummary', '{{total}} / month', { total: formatCurrency(monthlyTotal, 2) })}
          </Caption>
          <Link
            to="/vehicle-management"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
          >
            {t('widget.subscriptions.manage', 'Manage')}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      ) : undefined}
    >
      <InstrumentPresentation family="list" headline={headline} details={detailList}
        icon={parsed.length > 0 ? <CreditCard /> : undefined}>
        {detailList}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
