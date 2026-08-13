import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TeslaOpaqueObject } from '@/api/types'
import { AlertBanner } from '@/components/feedback'
import { Button, Modal, Textarea } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { parseNonEmptyJSONObject } from './managementJson'

interface OpaqueJsonDialogProps {
  open: boolean
  title: string
  description: string
  submitLabel: string
  pending?: boolean
  destructive?: boolean
  onClose: () => void
  onSubmit: (payload: TeslaOpaqueObject) => void
}

export function OpaqueJsonDialog({
  open,
  title,
  description,
  submitLabel,
  pending = false,
  destructive = false,
  onClose,
  onSubmit,
}: OpaqueJsonDialogProps) {
  const { t } = useTranslation()
  const [source, setSource] = useState('{}')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSource('{}')
    setValidationError(null)
  }, [open])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseNonEmptyJSONObject(source)
    if (!parsed.ok) {
      const messages = {
        invalid: t(
          'vehicleManagement.json.invalid',
          'Enter valid JSON with no trailing content.',
        ),
        object_required: t(
          'vehicleManagement.json.objectRequired',
          'The payload must be a JSON object, not an array, scalar, or null.',
        ),
        empty: t(
          'vehicleManagement.json.empty',
          'The JSON object must contain at least one field.',
        ),
      }
      setValidationError(messages[parsed.reason])
      return
    }
    setValidationError(null)
    onSubmit(parsed.value)
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <form className="space-y-4 p-4 sm:p-6" onSubmit={handleSubmit}>
        <AlertBanner
          variant={destructive ? 'danger' : 'info'}
          icon={<Icons.fileJson className="h-4 w-4" />}
          title={t(
            'vehicleManagement.json.schemaTitle',
            'Tesla-controlled undocumented schema',
          )}
        >
          {description}
        </AlertBanner>

        <Textarea
          id="vehicle-management-json"
          label={t('vehicleManagement.json.label', 'JSON object')}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          rows={12}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          error={validationError ?? undefined}
          disabled={pending}
          required
        />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            variant={destructive ? 'danger' : 'primary'}
            loading={pending}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
