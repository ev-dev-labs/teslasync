import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SharedTripChange, SharedTripInvitation, SharedTripScope } from '@/api/hooks/useSharedTripPlanning'
import { ConfirmDialog, Subhead, Text } from '@/components/ui'
import { SharedTripComparisonCard } from './SharedTripComparisonCard'
import { SharedTripConfirmationForm } from './SharedTripConfirmationForm'
import { SharedTripInvitationRow } from './SharedTripInvitationRow'

interface Props {
  scope: SharedTripScope
  invitations: SharedTripInvitation[]
  disabled: boolean
  pending: boolean
  onChange: (input: SharedTripChange) => Promise<boolean>
}

function entryKey(entry: SharedTripInvitation) {
  return `${entry.trip_id}:${entry.revision}:${entry.vehicle_id}:${entry.entry_version}`
}

export function SharedTripParticipation({ scope, invitations, disabled, pending, onChange }: Props) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  const [comparing, setComparing] = useState<string | null>(null)
  const confirmationEntry = invitations.find((entry) => entryKey(entry) === confirming)
  const withdrawalEntry = invitations.find((entry) => entryKey(entry) === withdrawing)
  const comparisonEntry = invitations.find((entry) => entryKey(entry) === comparing)

  return (
    <section className="space-y-3">
      <Subhead>{t('smartCharging.sharedTrip.invitationsTitle', 'Your invitations')}</Subhead>
      {invitations.length === 0 ? (
        <Text as="p" variant="bodySm">
          {t('smartCharging.sharedTrip.noInvitations', 'No upcoming shared departures are awaiting or using your confirmation.')}
        </Text>
      ) : (
        <ul className="space-y-3">
          {invitations.map((entry) => (
            <SharedTripInvitationRow key={entryKey(entry)} entry={entry} disabled={disabled}
              onConfirm={() => { setComparing(null); setConfirming(entryKey(entry)) }}
              onWithdraw={() => setWithdrawing(entryKey(entry))}
              onCompare={() => { setConfirming(null); setComparing(entryKey(entry)) }} />
          ))}
        </ul>
      )}
      {confirmationEntry && (
        <SharedTripConfirmationForm key={entryKey(confirmationEntry)} entry={confirmationEntry}
          disabled={disabled} pending={pending} onClose={() => setConfirming(null)}
          onSave={async (confirmation) => {
            if (await onChange({ kind: 'confirm', entry: confirmationEntry, confirmation })) setConfirming(null)
          }} />
      )}
      {comparisonEntry && (
        <SharedTripComparisonCard key={entryKey(comparisonEntry)} scope={scope} entry={comparisonEntry}
          paused={pending} onClose={() => setComparing(null)} />
      )}
      <ConfirmDialog open={withdrawalEntry != null}
        title={t('smartCharging.sharedTrip.withdraw', 'Withdraw vehicle')}
        message={t('smartCharging.sharedTrip.withdrawDescription', 'Remove your vehicle and this invitation from the shared trip? You will need a new invitation to participate with this vehicle again.')}
        confirmLabel={t('smartCharging.sharedTrip.withdraw', 'Withdraw vehicle')}
        cancelLabel={t('smartCharging.sharedTrip.keepInvitation', 'Keep invitation')}
        confirmDisabled={disabled} loading={pending} onCancel={() => setWithdrawing(null)}
        onConfirm={() => {
          if (withdrawalEntry) {
            setComparing(null)
            void onChange({ kind: 'withdraw', entry: withdrawalEntry }).then((success) => {
              if (success) setWithdrawing(null)
            })
          }
        }} />
    </section>
  )
}
