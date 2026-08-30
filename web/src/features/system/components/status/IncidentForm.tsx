/**
 * Manual incident logging dialog.
 *
 * Operator UX:
 *   1. Click "Log incident" on /system-status → open this modal.
 *   2. Fill title (required) + severity + status + initial message.
 *   3. On submit, POST /api/v1/status/incidents and close. The
 *      list query is invalidated automatically by useCreateIncident.
 *
 * Validation: title length 3-200 enforced both client-side (here) and
 * server-side (database/status_incidents_repo.go). Mirror keeps both
 * surfaces consistent without round-trip.
 */

import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button, ConfirmDialog, Input, Textarea, Select } from '@/components/ui'
import { useToast } from '@/components/feedback'
import { useDiscardChangesGuard } from '@/hooks/useDiscardChangesGuard'
import {
  useCreateIncident,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/api/hooks/useIncidents'

interface IncidentFormProps {
  onClose: () => void
}

export function IncidentForm({ onClose }: IncidentFormProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState('')
  const [severity, setSeverity] = useState<IncidentSeverity>('minor')
  const [status, setStatus] = useState<IncidentStatus>('investigating')
  const [message, setMessage] = useState('')
  const [components, setComponents] = useState('')
  const create = useCreateIncident()
  const isDirty = title !== ''
    || severity !== 'minor'
    || status !== 'investigating'
    || message !== ''
    || components !== ''
  const { requestClose, dialogProps: discardDialogProps } = useDiscardChangesGuard(
    isDirty,
    onClose,
    {
      message: t(
        'systemStatus.incidents.unsaved',
        'You have unsaved incident details. Discard them?',
      ),
    },
  )

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setTitleError('')
    const trimmed = title.trim()
    if (trimmed.length < 3) {
      // Surface the error on the field itself (aria-invalid + aria-describedby
      // via Input's `error`) so assistive tech ties it to the input — a
      // transient toast alone isn't programmatically associated (WCAG 3.3.1).
      setTitleError(t(
        'systemStatus.incidents.titleMin',
        'Title must be at least 3 characters.',
      ))
      return
    }
    try {
      await create.mutateAsync({
        title: trimmed,
        severity,
        status,
        initial_message: message.trim() || undefined,
        affected_components: components
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      })
      toast.success(t('systemStatus.incidents.logged', 'Incident logged.'))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error
        ? err.message
        : t('systemStatus.incidents.logFailed', 'Failed to log incident'))
    }
  }

  return (
    <>
      <Modal
        open
        onClose={requestClose}
        title={t('systemStatus.incidents.logTitle', 'Log an incident')}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('systemStatus.incidents.title', 'Title')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (titleError) setTitleError('')
            }}
            placeholder={t(
              'systemStatus.incidents.titlePlaceholder',
              'e.g. Wall connector restart at 14:00',
            )}
            maxLength={200}
            required
            autoFocus
            error={titleError || undefined}
          />
          <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('systemStatus.incidents.severity', 'Severity')}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
            options={[
              { value: 'minor', label: t('systemStatus.incidents.minor', 'Minor') },
              { value: 'major', label: t('systemStatus.incidents.major', 'Major') },
              { value: 'critical', label: t('systemStatus.incidents.critical', 'Critical') },
            ]}
          />
          <Select
            label={t('systemStatus.incidents.status', 'Status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as IncidentStatus)}
            options={[
              { value: 'investigating', label: t('systemStatus.incidents.investigating', 'Investigating') },
              { value: 'identified', label: t('systemStatus.incidents.identified', 'Identified') },
              { value: 'monitoring', label: t('systemStatus.incidents.monitoring', 'Monitoring') },
              { value: 'resolved', label: t('systemStatus.incidents.resolved', 'Resolved') },
            ]}
          />
          </div>
          <Input
            label={t('systemStatus.incidents.components', 'Affected components')}
            hint={t(
              'systemStatus.incidents.componentsHint',
              'Optional. Separate multiple component names with commas.',
            )}
            value={components}
            onChange={(e) => setComponents(e.target.value)}
            placeholder={t('systemStatus.incidents.componentsPlaceholder', 'e.g. tesla, telemetry')}
          />
          <Textarea
            label={t('systemStatus.incidents.initialMessage', 'Initial timeline message')}
            hint={t('systemStatus.incidents.initialMessageHint', 'Optional context for the incident timeline.')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('systemStatus.incidents.messagePlaceholder', "What's the situation?")}
            rows={3}
            maxLength={4000}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={requestClose} disabled={create.isPending}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              {create.isPending
                ? t('systemStatus.incidents.logging', 'Logging…')
                : t('systemStatus.incidents.logAction', 'Log incident')}
            </Button>
          </div>
        </form>
      </Modal>
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </>
  )
}
