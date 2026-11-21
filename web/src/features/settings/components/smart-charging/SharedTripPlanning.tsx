import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import {
  isSharedTripIdentityError, sharedTripMaxOffset, sharedTripPageSize, useSharedTripChange, useSharedTripPlanning,
  type SharedTripChange, type SharedTripScope,
} from '@/api/hooks/useSharedTripPlanning'
import { QueryError, Skeleton } from '@/components/feedback'
import { Button, ErrorText, GlassPanel, PanelTitle, Text } from '@/components/ui'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { SharedTripManagement } from './SharedTripManagement'
import { SharedTripParticipation } from './SharedTripParticipation'

function SignedInSharedTripPlanning({ scope }: { scope: SharedTripScope }) {
  const { t } = useTranslation()
  const [offset, setOffset] = useState(0)
  const list = useSharedTripPlanning(scope, offset)
  const change = useSharedTripChange(scope)
  const { canWrite, writeBlockReason } = useOperationalMode()
  const disabled = !canWrite || list.isFetching || change.isPending
  const save = async (input: SharedTripChange) => {
    if (disabled) return false
    try {
      await change.mutateAsync(input)
      return true
    } catch {
      return false
    }
  }
  const retry = () => {
    change.reset()
    void list.refetch()
  }

  if (list.isError || isSharedTripIdentityError(change.error)) {
    return <QueryError error={list.error ?? change.error} onRetry={retry} />
  }
  if (!list.data) return <Skeleton lines={3} />

  const owned = list.data.owned ?? []
  const invitations = list.data.invitations ?? []
  const hasNext = offset < sharedTripMaxOffset && Math.max(owned.length, invitations.length) === sharedTripPageSize
  return (
    <>
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      {change.isError && <ErrorText role="alert">
        {t('smartCharging.sharedTrip.changeFailed', 'The shared trip change was not saved. Refresh and try again.')}
      </ErrorText>}
      {change.isSuccess && <Text as="p" variant="bodySm" role="status">
        {t('smartCharging.sharedTrip.changeSaved', 'Shared trip change saved.')}
      </Text>}
      {list.data.can_manage && (
        <SharedTripManagement trips={owned} disabled={disabled} pending={change.isPending} onChange={save} />
      )}
      <SharedTripParticipation scope={scope} invitations={invitations}
        disabled={disabled} pending={change.isPending} onChange={save} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={list.isFetching || change.isPending} onClick={retry}>
          {t('smartCharging.sharedTrip.refresh', 'Refresh shared trips')}
        </Button>
        {offset > 0 && (
          <Button size="sm" variant="secondary" disabled={change.isPending}
            onClick={() => setOffset((value) => Math.max(0, value - sharedTripPageSize))}>
            {t('smartCharging.sharedTrip.previousPage', 'Previous page')}
          </Button>
        )}
        {hasNext && (
          <Button size="sm" variant="secondary" disabled={change.isPending}
            onClick={() => setOffset((value) => value + sharedTripPageSize)}>
            {t('smartCharging.sharedTrip.nextPage', 'Next page')}
          </Button>
        )}
      </div>
    </>
  )
}

export function SharedTripPlanning({ scope }: { scope: PersonalScope }) {
  const { t } = useTranslation()

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <PanelTitle>{t('smartCharging.sharedTrip.title', 'Shared trip planning')}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.sharedTrip.description', 'Compare vehicles for one explicitly shared departure. Only verified participants who confirm their invitation can view the comparison.')}
      </Text>
      {scope.mode !== 'forward_auth' ? (
        <Text as="p" variant="bodySm">
          {t('smartCharging.sharedTrip.signInRequired', 'Shared trip planning requires a verified browser sign-in.')}
        </Text>
      ) : (
        <SignedInSharedTripPlanning key={scope.subject} scope={scope} />
      )}
    </GlassPanel>
  )
}
