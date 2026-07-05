import { useTranslation } from 'react-i18next';

import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

/** Number of KPI placeholder tiles in the middle band — mirrors the real
 * digest's six-metric hero grid so the layout doesn't reflow on load. */
const KPI_PLACEHOLDER_COUNT = 6;

/**
 * Loading placeholder for the Weekly Digest surface. Mirrors the digest's
 * three-band layout (header → KPI grid → detail panel) so the page doesn't
 * reflow when the real content streams in.
 *
 * The skeleton is exposed as an accessible live region (`role="status"` +
 * `aria-busy`, which the repo's shared skeletons — e.g. PageLoadSkeleton —
 * standardise on) so assistive tech announces that content is loading rather
 * than silently reading a cluster of decorative pulse blocks.
 */
export function DigestSkeleton() {
  const { t } = useTranslation();

  return (
    <FadeIn>
      <div
        role="status"
        aria-busy="true"
        aria-label={t('analytics.weeklyDigest.loading', 'Loading weekly digest')}
        data-testid="digest-skeleton"
        className="space-y-6"
      >
        <GlassPanel className="p-6">
          <Skeleton lines={2} />
        </GlassPanel>
        <GlassPanel className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: KPI_PLACEHOLDER_COUNT }).map((_, i) => (
            <Skeleton key={i} height={80} />
          ))}
        </GlassPanel>
        <GlassPanel className="p-6">
          <Skeleton height={260} />
        </GlassPanel>
      </div>
    </FadeIn>
  );
}
