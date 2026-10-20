/**
 * StatusPageSkeleton occupies only the health hero's initial-loading slot.
 * Independent source sections remain mounted by SystemStatusPage.
 */

import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/feedback'
import { GlassPanel } from '@/components/ui'

export function StatusPageSkeleton() {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('systemStatus.skeletonLoading', 'Loading system status')}
      data-testid="status-page-skeleton"
    >
      <GlassPanel className="p-4 md:p-5">
        <div className="flex flex-col items-center gap-4 md:flex-row md:gap-6">
          <Skeleton rounded className="h-14 w-14 shrink-0" />
          <div className="w-full flex-1 min-w-0 space-y-2">
            <Skeleton className="h-6 w-3/5 mx-auto md:mx-0" />
            <Skeleton className="h-4 w-2/5 mx-auto md:mx-0" />
          </div>
          <Skeleton className="h-11 w-40 shrink-0" />
        </div>
      </GlassPanel>
    </div>
  )
}
