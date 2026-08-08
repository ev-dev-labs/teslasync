import {
  CalendarDays,
  CalendarRange,
  Clock3,
  Database,
  MapPinned,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import {
  rangeBufferBandLabel,
  rangeBufferNumber,
  rangeBufferShare,
} from './labels';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type { RangeBufferQueryState } from './types';

interface RangeBufferEvidenceSupportProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  locale: string;
}

export function RangeBufferEvidenceSupport({
  result,
  state,
  locale,
}: RangeBufferEvidenceSupportProps) {
  const { t } = useTranslation();
  const support = result.coverage.support;

  return (
    <section data-testid="range-buffer-evidence-support">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'rangeBuffer.support.title',
            'Evidence support and coverage',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'rangeBuffer.support.subtitle',
            'Support measures returned sample breadth and recency; it is separate from whether arrival SoC is high or low.',
          )}
        </Text>
        <RangeBufferSectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label={t('rangeBuffer.support.index', 'Support index')}
              value={`${rangeBufferNumber(support.index, locale, 1)}/100`}
              subtitle={rangeBufferBandLabel(t, support.band)}
              icon={<ShieldCheck className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t('rangeBuffer.support.samples', 'Included arrivals')}
              value={fmtInt(result.accounting.includedRows)}
              subtitle={t(
                'rangeBuffer.support.sampleTarget',
                '50-row volume target',
              )}
              icon={<Database className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t('rangeBuffer.support.days', 'Active local days')}
              value={fmtInt(result.coverage.activeLocalDays)}
              subtitle={t(
                'rangeBuffer.support.dayTarget',
                '20-day breadth target',
              )}
              icon={<CalendarDays className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t('rangeBuffer.support.weeks', 'Active local weeks')}
              value={fmtInt(result.coverage.activeLocalWeeks)}
              subtitle={t(
                'rangeBuffer.support.weekTarget',
                '8-week breadth target',
              )}
              icon={<CalendarRange className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t('rangeBuffer.support.recency', 'Recency')}
              value={
                result.coverage.daysSinceLastObservation == null
                  ? '—'
                  : t(
                      'rangeBuffer.support.daysValue',
                      '{{value}} days',
                      {
                        value: rangeBufferNumber(
                          result.coverage.daysSinceLastObservation,
                          locale,
                          1,
                        ),
                      },
                    )
              }
              subtitle={t(
                'rangeBuffer.support.sinceLatest',
                'since latest included arrival',
              )}
              icon={<Clock3 className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'rangeBuffer.support.destinationCoverage',
                'Repeated-destination coverage',
              )}
              value={rangeBufferShare(
                result.destinationCoverage.repeatedCoverage,
                locale,
              )}
              subtitle={t(
                'rangeBuffer.support.supportedDestinations',
                '{{count}} supported destinations',
                {
                  count:
                    result.destinationCoverage.supportedDestinations,
                },
              )}
              icon={<MapPinned className="h-5 w-5" />}
              color="cyan"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'rangeBuffer.support.formula',
                'Support index = 100 x (0.35 x sample volume + 0.25 x active days + 0.25 x active weeks + 0.15 x recency). Volume ingredients saturate at 50 arrivals, 20 days, and 8 weeks; recency scores 1 through 7 days, 0.75 through 30, 0.5 through 90, 0.25 through 180, then 0. Bands are thin below 35, developing below 70, and strong from 70.',
              )}
            </Text>
          </AlertBanner>
          {result.coverage.omittedTrendMonths > 0 ? (
            <AlertBanner className="mt-3" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'rangeBuffer.support.monthLimit',
                  '{{shown}} of {{returned}} returned local months are shown in the trend; the oldest {{omitted}} are omitted from that chart only.',
                  {
                    shown: result.coverage.displayedTrendMonths,
                    returned: result.coverage.returnedTrendMonths,
                    omitted: result.coverage.omittedTrendMonths,
                  },
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </RangeBufferSectionBody>
      </GlassPanel>
    </section>
  );
}
