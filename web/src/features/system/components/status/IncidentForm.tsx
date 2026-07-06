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

import { useId, useState, type FormEvent } from 'react'
import { Modal, Button, Input, Textarea, Select } from '@/components/ui'
import { useToast } from '@/components/feedback/Toast'
import {
  useCreateIncident,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/api/hooks/useIncidents'

interface IncidentFormProps {
  onClose: () => void
}

export function IncidentForm({ onClose }: IncidentFormProps) {
  const toast = useToast()
  const titleId = useId()
  const componentsId = useId()
  const messageId = useId()
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState('')
  const [severity, setSeverity] = useState<IncidentSeverity>('minor')
  const [status, setStatus] = useState<IncidentStatus>('investigating')
  const [message, setMessage] = useState('')
  const [components, setComponents] = useState('')
  const create = useCreateIncident()

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setTitleError('')
    const trimmed = title.trim()
    if (trimmed.length < 3) {
      // Surface the error on the field itself (aria-invalid + aria-describedby
      // via Input's `error`) so assistive tech ties it to the input — a
      // transient toast alone isn't programmatically associated (WCAG 3.3.1).
      setTitleError('Title must be at least 3 characters.')
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
      toast.success('Incident logged.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log incident')
    }
  }

  return (
    <Modal open onClose={onClose} title="Log an incident" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={titleId} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Title</label>
          <Input
            id={titleId}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (titleError) setTitleError('')
            }}
            placeholder="e.g. Wall connector restart at 14:00"
            maxLength={200}
            required
            autoFocus
            error={titleError || undefined}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
            options={[
              { value: 'minor', label: 'Minor' },
              { value: 'major', label: 'Major' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as IncidentStatus)}
            options={[
              { value: 'investigating', label: 'Investigating' },
              { value: 'identified', label: 'Identified' },
              { value: 'monitoring', label: 'Monitoring' },
              { value: 'resolved', label: 'Resolved' },
            ]}
          />
        </div>
        <div>
          <label htmlFor={componentsId} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Affected components <span className="text-[var(--text-muted)]">(comma-separated, optional)</span></label>
          <Input
            id={componentsId}
            value={components}
            onChange={(e) => setComponents(e.target.value)}
            placeholder="e.g. tesla, telemetry"
          />
        </div>
        <div>
          <label htmlFor={messageId} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Initial timeline message <span className="text-[var(--text-muted)]">(optional)</span></label>
          <Textarea
            id={messageId}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What's the situation?"
            rows={3}
            maxLength={4000}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'Logging…' : 'Log incident'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
