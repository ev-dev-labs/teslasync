import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, Input, PanelTitle, Text } from '@/components/ui'
import type { SmartCommuteChange } from '@/api/hooks/useSmartCommute'
import { browserTimeZone } from '@/lib/dateFormat'
import type { SmartCommuteSettings } from '@/types/smartCommute'
import { SmartCommuteToggleRow } from './SmartCommuteToggleRow'

interface Props {
  settings: SmartCommuteSettings
  stateLabel: string
  disabled: boolean
  busy: boolean
  onChange: (change: SmartCommuteChange) => Promise<boolean>
}

export function SmartCommuteControls({ settings, stateLabel, disabled, busy, onChange }: Props) {
  const { t } = useTranslation()
  const [zoneDraft, setZoneDraft] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const timeZone = zoneDraft ?? (settings.time_zone || browserTimeZone())

  const save = async (next: Partial<SmartCommuteSettings>) => {
    const saved = await onChange({
      kind: 'settings',
      settings: { ...settings, time_zone: timeZone.trim(), ...next },
    })
    if (saved) setZoneDraft(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <PanelTitle>{t('smartCommute.controls', 'Recurring drives')}</PanelTitle>
        <Text as="p" variant="bodySm" className="mt-1">
          {t('smartCommute.status', 'Status: {{status}}', { status: stateLabel })}
        </Text>
      </div>
      <Text as="p" variant="bodySm">
        {t('smartCommute.localOnly', 'Local analysis examines up to eight weeks of this vehicle’s completed drives on this server. It does not identify the driver.')}
      </Text>
      <Text as="p" variant="bodySm">
        {t('smartCommute.notAvailable', 'Live traffic, personal push delivery and destination commands are not available here yet. Nothing is sent to a traffic provider or vehicle.')}
      </Text>
      <Input label={t('smartCommute.analysisTimeZone', 'Time zone for local analysis')} maxLength={128}
        value={timeZone} onChange={(event) => setZoneDraft(event.target.value)} disabled={disabled}
        hint={t('smartCommute.timeZoneHint', 'For example, America/Los_Angeles.')} />
      {settings.enabled && zoneDraft != null && zoneDraft.trim() !== settings.time_zone && (
        <Button type="button" variant="secondary" className="min-h-11" disabled={disabled || !timeZone.trim()}
          onClick={() => void save({})}>
          {t('smartCommute.saveTimeZone', 'Save time zone')}
        </Button>
      )}
      <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
        <SmartCommuteToggleRow label={t('smartCommute.enable', 'Enable Smart Commute for this vehicle')}
          description={t('smartCommute.enableHint', 'Enable this vehicle’s commute settings and routines.')}
          checked={settings.enabled} disabled={disabled || !timeZone.trim()}
          onChange={(enabled) => void save({
            enabled,
            local_analysis_enabled: enabled ? settings.local_analysis_enabled : false,
            paused: enabled ? settings.paused : false,
          })} />
        <SmartCommuteToggleRow label={t('smartCommute.localAnalysis', 'Allow local analysis of completed drives')}
          description={t('smartCommute.localAnalysisHint', 'Use this vehicle’s completed drives on this server to suggest routines.')}
          checked={settings.local_analysis_enabled} disabled={disabled || !settings.enabled || !timeZone.trim()}
          onChange={(local_analysis_enabled) => void save({ local_analysis_enabled })} />
        <SmartCommuteToggleRow label={t('smartCommute.pause', 'Pause Smart Commute')}
          description={t('smartCommute.pauseHint', 'Temporarily pause Smart Commute without deleting your routines.')}
          checked={settings.paused} disabled={disabled || !settings.enabled || !timeZone.trim()}
          onChange={(paused) => void save({ paused })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" className="min-h-11" disabled={disabled ||
          !settings.enabled || !settings.local_analysis_enabled || settings.paused}
          onClick={() => void onChange({ kind: 'analyze' })}>
          {t('smartCommute.analyzeAgain', 'Analyze completed drives again')}
        </Button>
        <Button type="button" variant="danger" className="min-h-11" disabled={disabled}
          onClick={() => setDeleteOpen(true)}>
          {t('smartCommute.deleteAll', 'Delete my Smart Commute data')}
        </Button>
      </div>
      <ConfirmDialog open={deleteOpen} loading={busy} variant="danger"
        title={t('smartCommute.deleteTitle', 'Delete your Smart Commute data?')}
        message={t('smartCommute.deleteDescription', 'This turns the feature off and deletes your routines and decisions for this vehicle. Your original drives are not deleted.')}
        confirmLabel={t('smartCommute.deleteConfirm', 'Delete data')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => { void onChange({ kind: 'deleteAll' }).then((saved) => { if (saved) setDeleteOpen(false) }) }} />
    </div>
  )
}
