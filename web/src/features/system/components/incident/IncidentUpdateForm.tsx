/**
 * Operator "append update" form for an open incident. Owns its own draft state
 * and append mutation; posting can optionally advance the incident status.
 */
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Textarea, Select } from '@/components/ui'
import { useToast } from '@/components/feedback'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import {
  useAppendIncidentUpdate,
  type Incident,
  type IncidentStatus,
} from '@/api/hooks/useIncidents'
import { useIncidentStatusLabel } from './incidentPresentation'

interface IncidentUpdateFormProps {
  incident: Incident
}

export function IncidentUpdateForm({ incident }: IncidentUpdateFormProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const statusLabel = useIncidentStatusLabel()
  const appendUpdate = useAppendIncidentUpdate()

  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState('')
  const [nextStatus, setNextStatus] = useState<IncidentStatus | ''>('')
  const isDirty = message !== '' || nextStatus !== ''
  useDirtyForm(isDirty)
  useNavigationGuard(
    isDirty,
    t('incidentTimeline.unsavedUpdate', 'You have an unsaved incident update.'),
  )

  const statusOptions = [
    { value: '', label: `${t('incidentTimeline.keepStatus', 'Keep status as')} ${statusLabel(incident.status)}` },
    { value: 'investigating', label: `→ ${statusLabel('investigating')}` },
    { value: 'identified', label: `→ ${statusLabel('identified')}` },
    { value: 'monitoring', label: `→ ${statusLabel('monitoring')}` },
    { value: 'resolved', label: `→ ${statusLabel('resolved')}` },
  ]

  const handleAppend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const m = message.trim()
    if (!m) {
      setMessageError(t('incidentTimeline.updateRequired', 'Update message is required.'))
      return
    }
    setMessageError('')
    try {
      await appendUpdate.mutateAsync({
        id: incident.id,
        payload: { message: m, status: (nextStatus || undefined) as IncidentStatus | undefined },
      })
      setMessage('')
      setNextStatus('')
      toast.success(t('incidentTimeline.updateAdded', 'Update added.'))
    } catch (err) {
      // Fall back to a friendly default when the failure carries no message
      // (e.g. `new Error('')`) so the operator never sees an empty error toast.
      const fallback = t('incidentTimeline.updateFailed', 'Failed to append update')
      toast.error(err instanceof Error && err.message ? err.message : fallback)
    }
  }

  return (
    <form
      onSubmit={handleAppend}
      className="space-y-3"
      aria-label={t('incidentTimeline.formLabel', 'Add incident update')}
    >
      <Textarea
        label={t('incidentTimeline.updateLabel', 'Update message')}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value)
          setMessageError('')
        }}
        placeholder={t('incidentTimeline.updatePlaceholder', "What's new? Investigation step, mitigation applied, hypothesis…")}
        rows={4}
        maxLength={4000}
        required
        error={messageError || undefined}
      />
      <Select
        value={nextStatus}
        onChange={(e) => setNextStatus(e.target.value as IncidentStatus | '')}
        aria-label={t('incidentTimeline.changeStatus', 'Change status with this update')}
        options={statusOptions}
      />
      <Button type="submit" variant="primary" loading={appendUpdate.isPending} className="w-full">
        {appendUpdate.isPending ? t('incidentTimeline.adding', 'Adding…') : t('incidentTimeline.addUpdate', 'Add update')}
      </Button>
    </form>
  )
}
