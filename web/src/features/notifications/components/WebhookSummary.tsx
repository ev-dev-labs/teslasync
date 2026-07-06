/**
 * WebhookSummary — full-width KPI band for the Webhooks page.
 *
 * Derives a responsive metric bento from `useWebhookChannels()` (passed in from
 * the page so it dedupes with WebhookChannelsSection's own fetch and the
 * freshness chip). Every state — loading, error — is handled here so the band is
 * self-sufficient and stays visible regardless of data availability. The empty
 * case renders as zeros rather than a blank panel: the adjacent
 * WebhookChannelsSection already owns the "add your first webhook" call-to-action,
 * so a second empty state here would be redundant.
 *
 * Each value states its status in words (not colour alone) so the band stays
 * legible for colour-blind users.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Power, Send, ShieldCheck, Webhook } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { QueryError, StatGridSkeleton } from '@/components/feedback';
import type { useWebhookChannels } from '@/api/hooks/useNotificationChannels';

export interface WebhookSummaryProps {
  /** The webhook-channels query (spread TanStack result) from the page. */
  query: ReturnType<typeof useWebhookChannels>;
}

/** Responsive KPI grid summarising the configured webhook endpoints. */
export function WebhookSummary({ query }: WebhookSummaryProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const webhooks = query.data ?? [];
    let enabled = 0;
    let secure = 0;
    const methods = new Set<string>();
    for (const ch of webhooks) {
      if (ch.enabled) enabled += 1;
      if ((ch.url ?? '').trim().toLowerCase().startsWith('https://')) secure += 1;
      // `method` is nominally 'GET' | 'POST' | 'PUT', but a malformed API row can
      // carry an empty or whitespace value that slips past `??`. Fall back to POST
      // (the server default) so an endpoint never contributes a blank token —
      // which would otherwise render the methods card as "" or ", GET".
      const method = (ch.method ?? '').trim().toUpperCase() || 'POST';
      methods.add(method);
    }
    return {
      total: webhooks.length,
      enabled,
      secure,
      methods: Array.from(methods).sort(),
    };
  }, [query.data]);

  const gridClass = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4';
  const sectionLabel = t('notifications.webhooks.summary.label', 'Webhook endpoints summary');

  if (query.isLoading) {
    return (
      <section aria-label={sectionLabel}>
        <StatGridSkeleton cards={4} />
      </section>
    );
  }

  if (query.isError) {
    return (
      <section aria-label={sectionLabel}>
        <GlassPanel className="p-4 sm:p-5">
          <QueryError
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
            resourceName={t('notifications.webhooks.summary.resource', 'webhook endpoints')}
          />
        </GlassPanel>
      </section>
    );
  }

  const methodsValue = stats.methods.length > 0
    ? stats.methods.join(', ')
    : t('notifications.webhooks.summary.methodsNone', '—');

  return (
    <section aria-label={sectionLabel} className={gridClass}>
      <MetricCard
        label={t('notifications.webhooks.summary.endpoints', 'Endpoints')}
        value={stats.total}
        subtitle={t('notifications.webhooks.summary.endpointsSub', 'Configured receivers')}
        icon={<Webhook className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('notifications.webhooks.summary.enabled', 'Enabled')}
        value={stats.total === 0 ? '—' : `${stats.enabled}/${stats.total}`}
        subtitle={t('notifications.webhooks.summary.enabledSub', 'Active receivers')}
        icon={<Power className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('notifications.webhooks.summary.secure', 'Secure transport')}
        value={stats.total === 0 ? '—' : `${stats.secure}/${stats.total}`}
        subtitle={t('notifications.webhooks.summary.secureSub', 'Delivered over HTTPS')}
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('notifications.webhooks.summary.methods', 'HTTP methods')}
        value={methodsValue}
        subtitle={t('notifications.webhooks.summary.methodsSub', 'Verbs in use')}
        icon={<Send className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
    </section>
  );
}
