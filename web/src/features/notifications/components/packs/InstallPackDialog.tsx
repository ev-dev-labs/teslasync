import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AlertPack, type PackSelection, useInstallAlertPack } from '@/api/hooks/useAlertPacks'
import { useVehicles } from '@/api/hooks/useVehicles'
import { Button, Caption, Input, Modal, Text, Toggle } from '@/components/ui'
import { AlertBanner, ErrorDisplay, Spinner, StaleRefreshWarning } from '@/components/feedback'
import { VehicleMultiSelect, type VehicleSelection } from '@/components/forms'
import { useDataState } from '@/hooks/useDataState'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import PackRulePreview from './PackRulePreview'

interface Props {
  pack: AlertPack
  onClose: () => void
}

export default function InstallPackDialog({ pack, onClose }: Props) {
  const { t } = useTranslation()
  const vehicles = useVehicles()
  const state = useDataState(vehicles)
  const install = useInstallAlertPack()
  const [vehicleSelection, setVehicleSelection] = useState<VehicleSelection>({ kind: 'all_sticky' })
  const [enabled, setEnabled] = useState(false)
  const [name, setName] = useState(pack.id === 'custom' ? pack.name : '')
  const [discard, setDiscard] = useState(false)
  const [selected, setSelected] = useState(() => pack.rules.map(rule => rule.id))
  const [selections, setSelections] = useState<Record<string, PackSelection>>(() => Object.fromEntries(pack.rules.map(template => [
    template.id, { template_id: template.id, value_num: template.rule.value_num ?? undefined, cooldown_min: template.rule.cooldown_min,
      message: t(`alertPacks.rules.${template.id}.message`, template.rule.msg_template ?? '') },
  ])))
  const snapshot = JSON.stringify({ name, enabled, vehicleSelection, selected: [...selected].sort(), selections })
  const initialSnapshot = useRef(snapshot)
  const hasUnsaved = snapshot !== initialSnapshot.current && !install.isSuccess
  useDirtyForm(hasUnsaved)
  useNavigationGuard(hasUnsaved, t('alertPacks.unsaved', 'You have an uninstalled alert pack configuration.'))
  const valid = (pack.id !== 'custom' || (name.trim().length > 0 && name.length <= 100)) && selected.length > 0 && (vehicleSelection.kind === 'all_sticky' || vehicleSelection.vehicle_ids.length > 0)
    && selected.every(id => {
      const choice = selections[id]
      const template = pack.rules.find(item => item.id === id)
      const value = choice.value_num ?? template?.rule.value_num
      const numericValid = value == null || (Number.isFinite(value) && value >= (template?.unit === '%' ? 0 : -100) && value <= 100)
      return numericValid && Boolean(choice.message?.trim()) && (choice.message?.length ?? 0) <= 1024
        && (choice.cooldown_min == null || (Number.isInteger(choice.cooldown_min) && choice.cooldown_min >= 1 && choice.cooldown_min <= 10080))
    })
  const close = () => {
    if (install.isPending) return
    if (hasUnsaved) setDiscard(true)
    else onClose()
  }
  const result = install.data
  return (
    <Modal open onClose={close} size="lg" title={t('alertPacks.preview', 'Preview {{name}}', { name: pack.id === 'custom' ? name : t(`alertPacks.catalog.${pack.id}.name`, pack.name) })}>
      <div className="space-y-4">
        {result ? (
          <>
            <AlertBanner variant="success">{t('alertPacks.installed', 'Pack installed. Created {{created}} rules; reused {{reused}} existing rules without changing them.', {
              created: result.members.filter(member => member.owned).length,
              reused: result.members.filter(member => !member.owned).length,
            })}</AlertBanner>
            {result.members.map(member => <Text key={member.template_id} variant="bodySm">{member.name} — {member.owned
              ? t('alertPacks.created', 'Created')
              : t('alertPacks.reused', 'Existing rule kept unchanged')}{!member.enabled ? ` (${t('alertPacks.disabled', 'disabled')})` : ''}</Text>)}
            <Button onClick={onClose}>{t('alertPacks.done', 'Done')}</Button>
          </>
        ) : (
          <>
            <Text>{t(`alertPacks.catalog.${pack.id}.description`, pack.description)}</Text>
            {pack.id === 'custom' && <Input label={t('alertPacks.packName', 'Pack name')} value={name} maxLength={100} disabled={install.isPending}
              onChange={e => setName(e.target.value)} />}
            <AlertBanner variant="info">{t('alertPacks.delivery', 'Uses your existing notification channels, preferences and quiet hours. No vehicle commands are sent. Telemetry availability varies by vehicle.')}</AlertBanner>
            <Caption>{t('alertPacks.duplicates', 'Matching triggers for the same vehicle selection are reused unchanged, even if disabled. Different thresholds or overlapping vehicle selections may still produce similar notifications.')}</Caption>
            {vehicles.isLoading ? <Spinner /> : state.fatalError ? <ErrorDisplay error={state.fatalError} onRetry={() => void vehicles.refetch()} /> : (
              <VehicleMultiSelect vehicles={vehicles.data ?? []} value={vehicleSelection} disabled={install.isPending}
                onChange={setVehicleSelection} />
            )}
            <StaleRefreshWarning state={state} />
            <Toggle label={t('alertPacks.enableInstall', 'Enable newly created rules immediately')} checked={enabled} disabled={install.isPending}
              onChange={setEnabled} />
            <Caption>{t('alertPacks.disabledDefault', 'New rules are disabled by default so you can review them. Existing rules keep their current enabled state.')}</Caption>
            {pack.rules.map(template => (
              <PackRulePreview key={template.id} template={template} selection={selections[template.id]}
                selected={selected.includes(template.id)} disabled={install.isPending}
                onToggle={checked => setSelected(ids => checked ? [...ids, template.id] : ids.filter(id => id !== template.id))}
                onChange={choice => setSelections(previous => ({ ...previous, [template.id]: choice }))} />
            ))}
            {install.error && <ErrorDisplay error={install.error} compact />}
            {!valid && <Caption>{t('alertPacks.invalid', 'Select at least one rule and a vehicle scope, and check message, threshold and cooldown values.')}</Caption>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!valid || vehicles.isLoading || Boolean(state.fatalError) || install.isPending} loading={install.isPending}
                onClick={() => install.mutate({
                  pack_id: pack.id, version: pack.version, enabled, name: pack.id === 'custom' ? name.trim() : undefined,
                  all_vehicles: vehicleSelection.kind === 'all_sticky',
                  vehicle_ids: vehicleSelection.kind === 'specific' ? vehicleSelection.vehicle_ids : [],
                  rules: selected.map(id => selections[id]),
                })}>{t('alertPacks.install', 'Install selected rules')}</Button>
              <Button variant="ghost" onClick={close} disabled={install.isPending}>{t('alertPacks.cancel', 'Cancel')}</Button>
            </div>
            {discard && <AlertBanner variant="warning">
              <Text>{t('alertPacks.discard', 'Discard this pack configuration? No rules have been installed.')}</Text>
              <Button variant="danger" onClick={onClose}>{t('alertPacks.discardConfirm', 'Discard configuration')}</Button>
              <Button variant="ghost" onClick={() => setDiscard(false)}>{t('alertPacks.keepEditing', 'Keep editing')}</Button>
            </AlertBanner>}
          </>
        )}
      </div>
    </Modal>
  )
}
