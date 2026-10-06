import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { combineDataStates, type DataState } from '@/api/dataState'
import { LayoutCard, SourceContent } from '@/components/layout'
import { KVList } from '@/components/data-display'
import { DataStateNotice, EmptyState, QueryError, Skeleton } from '@/components/feedback'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { isFiniteNumber } from '@/lib/numberFormat'

interface FeedbackFacetPanelProps {
  title: string
  icon: ReactNode
  emptyIcon: ReactNode
  counts: readonly { id: string; label: string; value: number | undefined }[]
  sources: readonly DataState<unknown>[]
  onRetry: () => void
  emptyMessage: string
  skeletonHeight: number
  footer?: ReactNode
  children: ReactNode
}

/** Facet denominators are meaningful only after every contributing count resolves. */
export function FeedbackFacetPanel({
  title, icon, emptyIcon, counts, sources, onRetry, emptyMessage, skeletonHeight, footer, children,
}: FeedbackFacetPanelProps) {
  const { t } = useTranslation()
  const { fmtInt } = useNumberFormatting()
  const combined = combineDataStates(sources)
  const complete = counts.every((count) => isFiniteNumber(count.value))
  const hasData = sources.some((source) => source.hasData)
  const fatalError = sources.find((source) => source.fatalError)?.fatalError
  const empty = complete && counts.every((count) => count.value === 0)
  const emptyBody = <EmptyState icon={emptyIcon} message={emptyMessage} />
  const loading = !hasData && !fatalError && combined.status === 'initial'

  return (
    <LayoutCard title={title} actions={icon} footer={footer}>
      <SourceContent
        state={loading ? 'loading' : combined.status === 'stale' ? 'retained' : empty ? 'empty' : 'ready'}
        label={title}
        emptyMessage={emptyMessage}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        loadingContent={<Skeleton height={skeletonHeight} />}
        emptyContent={emptyBody}
        errorRecovery={{ onRetry }}
      >
        {!complete && hasData && (
          <DataStateNotice state="partial" />
        )}
        {fatalError && <QueryError error={fatalError} onRetry={onRetry} />}
        {complete
          ? empty ? emptyBody : children
          : (
            <KVList
              layout="responsive"
              items={counts.map((count) => ({
                id: count.id,
                label: count.label,
                value: isFiniteNumber(count.value) ? fmtInt(count.value) : '—',
              }))}
            />
          )}
      </SourceContent>
    </LayoutCard>
  )
}
