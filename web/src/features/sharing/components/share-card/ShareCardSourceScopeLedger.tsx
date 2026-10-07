import { useTranslation } from 'react-i18next';

import { Badge, Table, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
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
      aria-label={t('shareCard.source.aria', 'Share card source query and scope ledger')}
    >
      <LayoutCard title={t('shareCard.source.title', 'Source, query, and scope ledger')}>
        <ShareCardSectionBody state={state} showCachedStatus>
          <Table aria-label={t('shareCard.source.title', 'Source, query, and scope ledger')}>

            <tbody>
            <tr>
              <th scope="row">
                <Text as="p" variant="label">
                  {t('shareCard.source.endpoint', 'GET /drives')}
                </Text>
              </th>
              <td>
                <Badge variant={state.cachedRefreshError ? 'warning' : 'success'}>
                  {state.cachedRefreshError
                    ? t('shareCard.source.cached', 'Cached')
                    : t('shareCard.source.resolved', 'Resolved')}
                </Badge>
              <Text as="p" variant="caption" className="mt-2">
                {t(
                  'shareCard.source.contract',
                  'One request, vehicle_id scoped, limit {{limit}}; the API can return at most {{limit}} rows.',
                  { limit: 1_000 },
                )}
              </Text>
              </td>
            </tr>
            <tr>
              <th scope="row">
              <Text as="p" variant="label">
                {t('shareCard.source.calendarScope', 'Selected calendar scope')}
              </Text>
              </th>
              <td>
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
              </td>
            </tr>
            <tr>
              <th scope="row">
              <Text as="p" variant="label">
                {t('shareCard.source.apiWindow', 'Half-open API window')}
              </Text>
              </th>
              <td>
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
              </td>
            </tr>
            <tr>
              <th scope="row">
              <Text as="p" variant="label">
                {t('shareCard.source.runtimeScope', 'Runtime accounting')}
              </Text>
              </th>
              <td className="text-right">
              <Text as="p" variant="caption" className="mt-2">
                {t(
                  'shareCard.source.runtimeCounts',
                  '{{returned}} returned · {{eligible}} eligible · {{rejected}} rejected',
                  {
                    returned: display.formatNumber(analysis.returnedRows),
                    eligible: display.formatNumber(analysis.eligibleRows),
                    rejected: display.formatNumber(
                      analysis.returnedRows - analysis.eligibleRows,
                    ),
                  },
                )}
              </Text>
              </td>
            </tr>
            </tbody>
          </Table>
        </ShareCardSectionBody>
      </LayoutCard>
    </section>
  );
}
