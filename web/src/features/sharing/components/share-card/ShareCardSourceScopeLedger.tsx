import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

export function ShareCardSourceScopeLedger({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();

  return (
    <section
      data-testid="share-card-source-scope"
      aria-label={t('shareCard.source.aria', 'Share Card source query and scope ledger')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('shareCard.source.title', 'Source, query, and scope ledger')}
        </PanelTitle>
        <ShareCardSectionBody state={state} showCachedStatus>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text as="p" variant="label">
                  {t('shareCard.source.endpoint', 'GET /drives')}
                </Text>
                <Badge variant={state.cachedRefreshError ? 'warning' : 'success'}>
                  {state.cachedRefreshError
                    ? t('shareCard.source.cached', 'Cached')
                    : t('shareCard.source.resolved', 'Resolved')}
                </Badge>
              </div>
              <Text as="p" variant="caption" className="mt-2">
                {t(
                  'shareCard.source.contract',
                  'One request, vehicle_id scoped, limit {{limit}}; the API can return at most {{limit}} rows.',
                  { limit: 1_000 },
                )}
              </Text>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="label">
                {t('shareCard.source.calendarScope', 'Selected calendar scope')}
              </Text>
              <Text as="p" variant="caption" className="mt-2">
                {t(
                  'shareCard.source.calendarRange',
                  '{{start}} through {{end}} in {{timezone}}',
                  {
                    start: analysis.window.startLabel,
                    end: analysis.window.endLabel,
                    timezone: analysis.window.resolvedTimezone,
                  },
                )}
              </Text>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="label">
                {t('shareCard.source.apiWindow', 'Half-open API window')}
              </Text>
              <Text as="p" variant="code" className="mt-2 break-all">
                {t(
                  'shareCard.source.apiBounds',
                  '{{start}} ≤ start_ts < {{end}}',
                  {
                    start: analysis.window.startInstant,
                    end: analysis.window.endInstantExclusive,
                  },
                )}
              </Text>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="label">
                {t('shareCard.source.runtimeScope', 'Runtime accounting')}
              </Text>
              <Text as="p" variant="caption" className="mt-2">
                {t(
                  'shareCard.source.runtimeCounts',
                  '{{returned}} returned · {{eligible}} eligible · {{rejected}} rejected',
                  {
                    returned: display.formatNumber(analysis.returnedRows, 0),
                    eligible: display.formatNumber(analysis.eligibleRows, 0),
                    rejected: display.formatNumber(
                      analysis.returnedRows - analysis.eligibleRows,
                      0,
                    ),
                  },
                )}
              </Text>
            </div>
          </div>
        </ShareCardSectionBody>
      </GlassPanel>
    </section>
  );
}
