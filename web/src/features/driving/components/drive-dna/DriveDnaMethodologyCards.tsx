import { Fingerprint, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';

import { DRIVE_DNA_MAX_CHART_POINTS } from '../../lib/driveDNA';

export function DriveDnaMethodologyCards() {
  const { t } = useTranslation();
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
        <Text as="h4" variant="subhead" className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDna.method.scopeTitle', 'Selection & telemetry scope')}
        </Text>
        <ul className="mt-3 space-y-2 pl-4">
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.scopeSelector',
              'The 1,000-drive cap qualifies only which drives can appear in the selector.',
            )}
          </Text>
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.scopeTelemetry',
              'The selected drive’s telemetry endpoint returns that drive’s full available emission feed and is not truncated by the selector cap.',
            )}
          </Text>
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.scopeOptional',
              'Elevation and other optional channels may be unavailable; missing values remain unavailable, never measured zero.',
            )}
          </Text>
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.chartBound',
              'Charts use at most {{limit}} deterministic points while retaining the first and last; evidence metrics use all valid rows.',
              { limit: DRIVE_DNA_MAX_CHART_POINTS },
            )}
          </Text>
        </ul>
      </div>

      <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
        <Text as="h4" variant="subhead" className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDna.method.interpretationTitle', 'Interpretation guardrails')}
        </Text>
        <ul className="mt-3 space-y-2 pl-4">
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.changeFeed',
              'Rows are chronological change-feed emissions with values forward-folded by StateReader, not uniform-time samples.',
            )}
          </Text>
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.powerBoundary',
              'The legacy response power value is kW and is multiplied by exactly 1,000 once at the model boundary to canonical W.',
            )}
          </Text>
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.countBasis',
              'Power states, speed bands, and regen shares are emission-count evidence, never duration or time shares.',
            )}
          </Text>
          <Text as="li" variant="bodySm">
            {t(
              'driveDna.method.noClaim',
              'Traits are deterministic artistic heuristics—not a score, diagnosis, stable personality assessment, efficiency verdict, or causal claim.',
            )}
          </Text>
        </ul>
      </div>
    </div>
  );
}
