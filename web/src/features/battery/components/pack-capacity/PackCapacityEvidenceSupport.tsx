import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  MetricBar,
  MetricCard,
} from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { chartTokens } from '@/lib/tokens';
import type { PackCapacityResult } from '../../lib/packCapacity';
import {
  packCapacityBandLabel,
  packCapacityNumber,
} from './labels';
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityEvidenceSupportProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
}

export function PackCapacityEvidenceSupport({
  result,
  state,
  locale,
}: PackCapacityEvidenceSupportProps) {
  const { t } = useTranslation();
  const support = result.coverage.support;
  const components = [
    {
      key: 'volume',
      label: t('packCapacity.support.volume', 'Measurement volume'),
      ingredient: support.observations,
      color: chartTokens.series[0],
    },
    {
      key: 'quality',
      label: t(
        'packCapacity.support.highInformation',
        'High-information measurements',
      ),
      ingredient: support.highInformation,
      color: chartTokens.series[1],
    },
    {
      key: 'span',
      label: t('packCapacity.support.span', 'Calendar span'),
      ingredient: support.spanDays,
      color: chartTokens.series[2],
    },
    {
      key: 'months',
      label: t('packCapacity.support.months', 'Active months'),
      ingredient: support.activeMonths,
      color: chartTokens.series[3],
    },
    {
      key: 'recency',
      label: t('packCapacity.support.recency', 'Recency'),
      ingredient: support.recency,
      color: chartTokens.series[4],
    },
  ];

  return (
    <section data-testid="pack-capacity-evidence-support">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'packCapacity.support.title',
            'Evidence-support index',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'packCapacity.support.subtitle',
            'A transparent breadth score for returned evidence; it is not confidence, accuracy, or pack condition.',
          )}
        </Text>
        <PackCapacitySectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
            <MetricCard
              label={t(
                'packCapacity.support.total',
                'Support score',
              )}
              value={`${packCapacityNumber(
                support.index,
                locale,
                1,
              )}/100`}
              subtitle={packCapacityBandLabel(t, support.band)}
              icon={<ShieldCheck className="h-5 w-5" />}
              color="cyan"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {components.map((component) => (
                <MetricBar
                  key={component.key}
                  label={component.label}
                  value={component.ingredient.score * 100}
                  max={100}
                  color={component.color}
                  sublabel={`${packCapacityNumber(
                    component.ingredient.value,
                    locale,
                    1,
                  )}/${component.ingredient.target}`}
                />
              ))}
            </div>
          </div>
          <AlertBanner className="mt-4" variant="warning">
            <Text as="p" variant="caption">
              {t(
                'packCapacity.support.notice',
                'A high support score means the returned sample is broader and more recent under these rules. It does not validate the implied-capacity model or turn it into a calibrated health estimate.',
              )}
            </Text>
          </AlertBanner>
        </PackCapacitySectionBody>
      </GlassPanel>
    </section>
  );
}
