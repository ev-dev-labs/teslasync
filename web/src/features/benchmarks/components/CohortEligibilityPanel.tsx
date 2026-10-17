import { UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, InlineCallout, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Table, Badge, Button } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import type { BenchmarkPrivacyStatus, BenchmarkRelease, BenchmarkReleasePage } from '@/api/hooks/useBenchmarks';
import type { DataState } from '@/api/dataState';

interface CohortEligibilityPanelProps {
  optedIn: boolean | undefined;
  release: BenchmarkRelease | null;
  minimumCohortSize: number;
  pending: boolean;
  loading: boolean;
  error: Error | null;
  onCreate: () => void;
  source?: DataState<BenchmarkReleasePage>;
  participationSource?: DataState<BenchmarkPrivacyStatus>;
  canAct?: boolean;
}

export function CohortEligibilityPanel({
  optedIn,
  release,
  minimumCohortSize,
  pending,
  loading,
  error,
  onCreate,
  source,
  participationSource,
  canAct = true,
}: CohortEligibilityPanelProps) {
  const { t } = useTranslation();
  const fatalError = participationSource?.fatalError ?? (optedIn === true ? source?.fatalError : null);
  const modelFamily = release
    ? t(
        `benchmarks.cohort.modelFamily.${release.model_family}`,
        release.model_family.replace('_', ' '),
      )
    : '';
  return (
    <LayoutCard
      title={t('benchmarks.cohort.title', 'Cohort eligibility')}
      actions={
        fatalError ? (
          <Badge variant="danger">{t('error.loadFailed', 'Failed to load data')}</Badge>
        ) : loading || optedIn == null ? (
          <Skeleton className="h-6 w-24 rounded-full" />
        ) : (
          <Badge variant={release && !release.suppressed ? 'success' : 'warning'} dot>
            {release && !release.suppressed
              ? t('benchmarks.cohort.eligible', 'Eligible')
              : t('benchmarks.cohort.pending', 'Not released')}
          </Badge>
        )
      }
    >
      {source && optedIn === true && <StaleRefreshWarning state={source} />}
      <SourceContent
        state={fatalError ? 'error' : optedIn == null ? 'loading' : 'ready'}
        label={t('benchmarks.cohort.title', 'Cohort eligibility')}
        emptyMessage={t('benchmarks.cohort.noRelease', 'No stable release yet')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={fatalError}
        errorRecovery={{ onRetry: (participationSource?.fatalError ? participationSource.retry : source?.retry) ?? undefined }}
      >
      {loading && !release ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('benchmarks.cohort.loading', 'Loading cohort eligibility…')}
          className="space-y-4 py-2"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-32" />
              </div>
            ))}
          </div>
          <Skeleton className="h-9 w-52" />
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
          <Table aria-label={t('benchmarks.cohort.title', 'Cohort eligibility')}><tbody>
            <tr>
              <th scope="row" className="text-[var(--text-muted)]">
                {t('benchmarks.cohort.model', 'Model family')}
              </th>
              <td className="font-medium text-[var(--text-primary)]">
                {modelFamily}
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-[var(--text-muted)]">
                {t('benchmarks.cohort.year', 'Model-year bucket')}
              </th>
              <td className="font-medium text-[var(--text-primary)] text-right">
                {release.model_year_bucket > 0
                  ? `${release.model_year_bucket}–${release.model_year_bucket + 4}`
                  : t('benchmarks.cohort.unknownYear', 'Unknown')}
              </td>
            </tr>
            <tr>
              <th scope="row" className="text-[var(--text-muted)]">
                {t('benchmarks.cohort.minimum', 'Release threshold')}
              </th>
              <td className="font-medium text-[var(--text-primary)]">
                {t('benchmarks.cohort.minimumValue', 'At least {{count}} vehicles', {
                  count: release.minimum_cohort_size,
                })}
              </td>
            </tr>
          </tbody></Table>
          {release.suppressed ? (
            <InlineCallout variant="warning">
              {t(
                `benchmarks.cohort.${release.suppression_reason ?? 'suppressed'}`,
                'This cohort is suppressed because it is too small, lacks enough metric data, or has exhausted its privacy budget.',
              )}
            </InlineCallout>
          ) : null}
          <Button type="button" variant="secondary" onClick={onCreate} loading={pending}
            disabled={pending || !canAct} className="min-h-11 md:min-h-10" wrapLabel>
            {t('benchmarks.cohort.refresh', 'Check current source version')}
          </Button>
        </div>
      ) : (
        <div>
          {/* no-action: the pending-aware create control is immediately below this empty state. */}
          <EmptyState
            icon={<UsersRound className="h-8 w-8" />}
            title={t('benchmarks.cohort.noRelease', 'No stable release yet')}
            message={t(
              'benchmarks.cohort.noReleaseMessage',
              'Create a release for the last three completed months. Cohorts below k={{count}} remain suppressed.',
              { count: minimumCohortSize },
            )}
            className="py-8"
          />
          <div className="flex justify-center">
            <Button type="button" variant="secondary" onClick={onCreate}
              loading={pending} disabled={pending || !canAct} wrapLabel className="min-h-11 md:min-h-10">
              {t('benchmarks.cohort.create', 'Create release')}
            </Button>
          </div>
        </div>
      )}
      </SourceContent>
      {error ? (
        <InlineCallout variant="danger" className="mt-3">
          {t('benchmarks.cohort.error', 'Could not create release: {{message}}', {
            message: error.message,
          })}
        </InlineCallout>
      ) : null}
    </LayoutCard>
  );
}
