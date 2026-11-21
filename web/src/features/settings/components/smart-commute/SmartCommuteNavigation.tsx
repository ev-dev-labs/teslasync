import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import { useSmartCommuteNavigation } from '@/api/hooks/useSmartCommute'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { Button, Input, Modal, Text } from '@/components/ui'
import type { SmartCommuteNavigationOutcome, SmartCommuteTrafficDecision } from '@/types/smartCommute'

interface Props {
  decision: SmartCommuteTrafficDecision
  scope: PersonalScope
  available: boolean
  disabled: boolean
}

export function SmartCommuteNavigation({ decision, scope, available, disabled }: Props) {
  const { t } = useTranslation()
  const formId = useId()
  const sending = useRef(false)
  const [dialog, setDialog] = useState(false)
  const [address, setAddress] = useState('')
  const [wake, setWake] = useState<'wake_required' | 'wake_permission_required'>()
  const [outcome, setOutcome] = useState<SmartCommuteNavigationOutcome>()
  const mutation = useSmartCommuteNavigation(scope, decision.vehicle_id, decision.routine_id)
  const visibleOutcome = decision.navigation_outcome ?? outcome
  const sendLabel = t('smartCommute.navigation.send', 'Send {{destination}} to {{vehicle}}', {
    destination: decision.routine_name, vehicle: decision.vehicle_name,
  })
  const eligible = available && !visibleOutcome && Date.parse(decision.expires_at) > Date.now()
  const busy = mutation.isPending
  const blocked = disabled || busy || !eligible

  function close() {
    if (sending.current) return
    setDialog(false)
    setWake(undefined)
    setAddress('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const destination = address.trim()
    if (sending.current || blocked || !destination || Date.parse(decision.expires_at) <= Date.now()) return
    sending.current = true
    let result: SmartCommuteNavigationOutcome
    try {
      result = await mutation.mutateAsync({
        occurrence_id: decision.occurrence_id, address: destination, wake_confirmed: wake != null,
      })
    } catch (error) {
      result = isApiError(error) && ['NAVIGATION_UNAVAILABLE', 'IDENTITY_CHANGED'].includes(error.code ?? '')
        ? 'expired' : 'delivery_unknown'
    } finally {
      mutation.reset()
      sending.current = false
    }
    if (result === 'wake_required' || result === 'wake_permission_required') {
      setWake(result)
    } else {
      setOutcome(result)
      close()
    }
  }

  const messages = {
    accepted: t('smartCommute.navigation.accepted', 'Tesla accepted the destination. Check the vehicle for its route.'),
    rejected: t('smartCommute.navigation.rejected', 'The request was rejected. The destination was not accepted.'),
    delivery_unknown: t('smartCommute.navigation.unknown', 'Delivery could not be confirmed. Check the vehicle; TeslaSync will not resend this request.'),
    expired: t('smartCommute.navigation.expired', 'This comparison is no longer actionable. TeslaSync will not send or resend it.'),
    not_sent: t('smartCommute.navigation.notSent', 'No destination was sent. If you allowed a wake, the vehicle may have woken.'),
  }
  return (
    <>
      {visibleOutcome && visibleOutcome !== 'wake_required' && visibleOutcome !== 'wake_permission_required' ? (
        <Text as="p" variant="bodySm" role="status">{messages[visibleOutcome]}</Text>
      ) : eligible ? (
        <Button size="sm" className="min-h-11" disabled={blocked} onClick={() => setDialog(true)}>{sendLabel}</Button>
      ) : null}
      <Modal open={dialog} onClose={close} title={sendLabel} footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={close}>{t('common.cancel', 'Cancel')}</Button>
          <Button type="submit" form={formId} loading={busy} disabled={blocked || !address.trim()}>
            {wake === 'wake_required' ? t('smartCommute.navigation.wake', 'Wake and send')
              : wake === 'wake_permission_required' ? t('smartCommute.navigation.allowWake', 'Allow wake and send')
                : t('smartCommute.navigation.checkVehicle', 'Check vehicle connection')}
          </Button>
        </>
      }>
        <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-3">
          <Text as="p" variant="bodySm">
            {t('smartCommute.navigation.disclosure', 'Confirm the destination address for {{destination}}. Tesla receives this address for the named vehicle and calculates its own route, not the HERE alternative.', {
              destination: decision.routine_name,
            })}
          </Text>
          <Input label={t('smartCommute.navigation.address', 'Destination address')} value={address}
            onChange={(event) => setAddress(event.target.value)} maxLength={400} required
            autoComplete="off" readOnly={wake != null || busy} data-autofocus />
          {wake && <Text as="p" variant="bodySm" role="status">
            {wake === 'wake_required'
              ? t('smartCommute.navigation.wakeRequired', 'Tesla reports the vehicle is asleep. Nothing has been sent. Wake and send allows one wake request and sends only if the vehicle comes online and the comparison is still current.')
              : t('smartCommute.navigation.wakePermission', 'Tesla reports the vehicle is online. Nothing has been sent. Tesla does not guarantee that sending a destination cannot wake it if its connection changes. Allow a possible wake to send this destination.')}
          </Text>}
        </form>
      </Modal>
    </>
  )
}
