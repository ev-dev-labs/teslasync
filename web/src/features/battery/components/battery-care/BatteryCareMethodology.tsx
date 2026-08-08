import { Database, FlaskConical, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  MetricLabel,
  MetricValue,
  Text,
} from '@/components/ui';
import { formatDate } from '@/lib/dateFormat';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import { useUnits } from '@/hooks/useUnits';

import {
  DC_INFERENCE_POWER_W,
  MIN_ENERGY_CLASSIFICATION_COVERAGE,
  MIN_SCORE_DRIVES,
  MIN_SCORE_ENERGY_SESSIONS,
  MIN_SCORE_SESSIONS,
  type CareScore,
} from '../../lib/batteryCare';
import { BatteryCareSection } from './BatteryCareSection';
import type { BatteryCareSectionState } from './types';

interface BatteryCareMethodologyProps {
  care: CareScore;
  state: BatteryCareSectionState;
  sessionLimit: number;
  driveLimit: number;
  className?: string;
}

/** Coverage, exclusions, calibration, and bounded-window interpretation. */
export function BatteryCareMethodology({
  care,
  state,
  sessionLimit,
  driveLimit,
  className,
}: BatteryCareMethodologyProps) {
  const { t } = useTranslation();
  const { formatPower } = useUnits();
  const coverage = care.coverage;
  const hasData =
    coverage.returnedSessions > 0 || coverage.returnedDrives > 0;
  const start = formatDate(
    coverage.observationStartMs != null
      ? new Date(coverage.observationStartMs)
      : null,
  );
  const end = formatDate(
    coverage.observationEndMs != null
      ? new Date(coverage.observationEndMs)
      : null,
  );
  const capMessage =
    coverage.sessionWindowCapped && coverage.driveWindowCapped
      ? t(
          'batteryCare.method.capBoth',
          'Both sources filled their requested caps ({{sessions}} sessions and {{drives}} drives); older rows may be absent.',
          { sessions: sessionLimit, drives: driveLimit },
        )
      : coverage.sessionWindowCapped
        ? t(
            'batteryCare.method.capSessions',
            'Charging history filled its {{limit}}-row request cap; older sessions may be absent.',
            { limit: sessionLimit },
          )
        : coverage.driveWindowCapped
          ? t(
              'batteryCare.method.capDrives',
              'Drive history filled its {{limit}}-row request cap; older drives may be absent.',
              { limit: driveLimit },
            )
          : t(
              'batteryCare.method.capOpen',
              'Neither source filled its requested row cap, but the result is still a returned observation window rather than a lifetime claim.',
            );

  return (
    <BatteryCareSection
      className={className}
      title={t('batteryCare.method.title', 'Coverage & methodology')}
      description={t(
        'batteryCare.method.description',
        'What qualified, what was excluded, and when the descriptive index is shown',
      )}
      icon={
        <FlaskConical
          className="h-4 w-4 text-purple-300"
          aria-hidden="true"
        />
      }
      emptyIcon={<Database className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t(
        'batteryCare.method.empty',
        'Coverage details will appear after charging sessions or drives are returned.',
      )}
      hasData={hasData}
      state={state}
      testId="battery-care-methodology"
      badge={
        <Badge variant={care.scoreReady ? 'success' : 'warning'} dot>
          {care.scoreReady
            ? t('batteryCare.method.ready', 'Composite available')
            : t('batteryCare.method.building', 'Composite withheld')}
        </Badge>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(coverage.returnedSessions)}</MetricValue>
          <MetricLabel>
            {t('batteryCare.method.returnedSessions', 'Sessions returned')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(care.sessionsAnalyzed)}</MetricValue>
          <MetricLabel>
            {t('batteryCare.method.eligibleSessions', 'End-SoC eligible')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(coverage.returnedDrives)}</MetricValue>
          <MetricLabel>
            {t('batteryCare.method.returnedDrives', 'Drives returned')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(care.drivesAnalyzed)}</MetricValue>
          <MetricLabel>
            {t('batteryCare.method.eligibleDrives', 'Arrival-SoC eligible')}
          </MetricLabel>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
          <Text as="p" variant="bodySm">
            {t(
              'batteryCare.method.calibration',
              'The composite requires at least {{sessions}} valid session ends, {{drives}} valid drive arrivals, and {{energy}} classified-energy sessions with at least {{coverage}} metadata coverage.',
              {
                sessions: MIN_SCORE_SESSIONS,
                drives: MIN_SCORE_DRIVES,
                energy: MIN_SCORE_ENERGY_SESSIONS,
                coverage: fmtPercent(
                  MIN_ENERGY_CLASSIFICATION_COVERAGE * 100,
                  0,
                ),
              },
            )}
          </Text>
        </div>
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          <Text as="p" variant="bodySm">
            {t(
              'batteryCare.method.exclusions',
              'Excluded: {{sessions}} sessions without valid end SoC, {{drives}} drives without valid arrival SoC, and {{energy}} sessions without positive measured energy. {{unknown}} energy sessions remain unclassified.',
              {
                sessions: coverage.excludedEndSocSessions,
                drives: coverage.excludedArrivalDrives,
                energy: coverage.excludedEnergySessions,
                unknown: coverage.unclassifiedEnergySessions,
              },
            )}
          </Text>
        </div>
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" aria-hidden="true" />
          <Text as="p" variant="bodySm">
            {t(
              'batteryCare.method.classification',
              'AC/DC classification uses explicit charger labels; an unlabeled session is treated as DC only when peak power exceeds {{power}}. Other energy remains unclassified.',
              { power: formatPower(DC_INFERENCE_POWER_W, { precision: 0 }) },
            )}
          </Text>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border-subtle)] p-3">
        <Text as="p" variant="caption">
          {t(
            'batteryCare.method.window',
            'Returned dated evidence spans {{start}} to {{end}}. {{capMessage}}',
            { start, end, capMessage },
          )}
        </Text>
        <Text as="p" variant="caption" className="mt-2">
          {t(
            'batteryCare.method.limitation',
            'The index describes observed habits only. It does not measure battery health, infer degradation, or know time spent at a given SoC.',
          )}
        </Text>
      </div>
    </BatteryCareSection>
  );
}
