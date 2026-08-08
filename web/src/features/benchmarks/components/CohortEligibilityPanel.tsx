import { UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, InlineCallout, Spinner } from '@/components/feedback';
import { Badge, Button, GlassPanel } from '@/components/ui';
import type { BenchmarkRelease } from '@/api/hooks/useBenchmarks';

interface CohortEligibilityPanelProps {
  optedIn: boolean;
  release: BenchmarkRelease | null;
  minimumCohortSize: number;
  pending: boolean;
  loading: boolean;
  error: Error | null;
  onCreate: () => void;
}

export function CohortEligibilityPanel({
  optedIn,
  release,
  minimumCohortSize,
  pending,
  loading,
  error,
  onCreate,
}: CohortEligibilityPanelProps) {
  const { t } = useTranslation();
  const modelFamily = release
    ? t(
        `benchmarks.cohort.modelFamily.${release.model_family}`,
        release.model_family.replace('_', ' '),
      )
    : '';
  return (
    <GlassPanel className="p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UsersRound className="h-5 w-5 text-emerald-300" aria-hidden />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {t('benchmarks.cohort.title', 'Cohort eligibility')}
          </h2>
        </div>
        <Badge variant={release && !release.suppressed ? 'success' : 'warning'} dot>
          {release && !release.suppressed
            ? t('benchmarks.cohort.eligible', 'Eligible')
            : t('benchmarks.cohort.pending', 'Not released')}
        </Badge>
      </div>
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !optedIn ? (
        // no-action: the opt-in control is the ConsentGate section rendered directly above this panel on the page; this card only reflects that state.
        <EmptyState
          icon={<UsersRound className="h-8 w-8" />}
          title={t('benchmarks.cohort.optInTitle', 'Consent required')}
          message={t(
            'benchmarks.cohort.optInMessage',
            'Opt in before TeslaSync can derive a bounded local contribution.',
          )}
          className="py-8"
        />
      ) : release ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--text-muted)]">
                {t('benchmarks.cohort.model', 'Model family')}
              </dt>
              <dd className="font-medium text-[var(--text-primary)]">
                {modelFamily}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">
                {t('benchmarks.cohort.year', 'Model-year bucket')}
              </dt>
              <dd className="font-medium text-[var(--text-primary)]">
                {release.model_year_bucket > 0
                  ? `${release.model_year_bucket}–${release.model_year_bucket + 4}`
                  : t('benchmarks.cohort.unknownYear', 'Unknown')}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">
                {t('benchmarks.cohort.minimum', 'Release threshold')}
              </dt>
              <dd className="font-medium text-[var(--text-primary)]">
                {t('benchmarks.cohort.minimumValue', 'At least {{count}} vehicles', {
                  count: release.minimum_cohort_size,
                })}
              </dd>
            </div>
          </dl>
          {release.suppressed ? (
            <InlineCallout variant="warning">
              {t(
                `benchmarks.cohort.${release.suppression_reason ?? 'suppressed'}`,
                'This cohort is suppressed because it is too small, lacks enough metric data, or has exhausted its privacy budget.',
              )}
            </InlineCallout>
          ) : null}
          <Button type="button" variant="secondary" onClick={onCreate} loading={pending}>
            {t('benchmarks.cohort.refresh', 'Check current source version')}
          </Button>
        </div>
      ) : (
        <EmptyState
          icon={<UsersRound className="h-8 w-8" />}
          title={t('benchmarks.cohort.noRelease', 'No stable release yet')}
          message={t(
            'benchmarks.cohort.noReleaseMessage',
            'Create a release for the last three completed months. Cohorts below k={{count}} remain suppressed.',
            { count: minimumCohortSize },
          )}
          action={{ label: t('benchmarks.cohort.create', 'Create release'), onClick: onCreate }}
          className="py-8"
        />
      )}
      {error ? (
        <InlineCallout variant="danger" className="mt-3">
          {t('benchmarks.cohort.error', 'Could not create release: {{message}}', {
            message: error.message,
          })}
        </InlineCallout>
      ) : null}
    </GlassPanel>
  );
}
