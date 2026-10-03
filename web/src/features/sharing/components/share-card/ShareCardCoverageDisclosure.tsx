import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Table, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

export function ShareCardCoverageDisclosure({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const dateOptions = { tz: analysis.window.resolvedTimezone };

  return (
    <section
      data-testid="share-card-coverage-disclosure"
      aria-label={t('shareCard.coverage.aria', 'Share card coverage and cap disclosure')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('shareCard.coverage.title', 'Coverage and cap disclosure')}
        </PanelTitle>
        <ShareCardSectionBody state={state}>
          <AlertBanner variant={analysis.historyCapReached ? 'warning' : 'info'}>
            {analysis.historyCapReached
              ? t(
                'shareCard.coverage.capped',
                'Exactly {{rows}} rows were returned, so this is an observed capped sample. Older drives inside the requested range may be absent; full-range or lifetime coverage is not claimed.',
                { rows: display.formatNumber(analysis.returnedRows) },
              )
              : t(
                'shareCard.coverage.returnedEvidence',
                '{{rows}} rows were returned as selected-window evidence. A sub-cap response is not a guarantee of complete lifetime or range coverage.',
                { rows: display.formatNumber(analysis.returnedRows) },
              )}
          </AlertBanner>
          <Table className="mt-4" aria-label={t('shareCard.coverage.title', 'Coverage and cap disclosure')}>
            <tbody>
            <tr>
              <th scope="row"><Text variant="label">{t('shareCard.coverage.earliest', 'Earliest evidence')}</Text></th>
              <td><Text variant="bodySm">
                {formatDateTime(analysis.earliestEvidence, dateOptions)}
              </Text></td>
            </tr>
            <tr>
              <th scope="row"><Text variant="label">{t('shareCard.coverage.latest', 'Latest evidence')}</Text></th>
              <td><Text variant="bodySm">
                {formatDateTime(analysis.latestEvidence, dateOptions)}
              </Text></td>
            </tr>
            <tr>
              <th scope="row"><Text variant="label">{t('shareCard.coverage.observedSpan', 'Observed span')}</Text></th>
              <td className="text-right"><Text variant="bodySm">
                {display.formatDuration(analysis.observedSpanS)}
              </Text></td>
            </tr>
            <tr>
              <th scope="row"><Text variant="label">{t('shareCard.coverage.activeDays', 'Active/requested days')}</Text></th>
              <td className="text-right"><Text variant="bodySm">
                {t('shareCard.coverage.dayRatio', '{{active}} / {{requested}}', {
                  active: analysis.activeDays,
                  requested: analysis.window.requestedCalendarDays ?? '—',
                })}
              </Text></td>
            </tr>
            </tbody>
          </Table>
        </ShareCardSectionBody>
      </GlassPanel>
    </section>
  );
}
