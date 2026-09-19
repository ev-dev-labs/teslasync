import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AlertPack, type PackSelection, useInstallAlertPack } from '@/api/hooks/useAlertPacks'
import { useVehicles } from '@/api/hooks/useVehicles'
import { Button, Caption, GlassPanel, Input, Modal, PanelTitle, Text, Toggle } from '@/components/ui'
import { SearchInput } from '@/components/forms'
import { AlertBanner, ErrorDisplay, Spinner, StaleRefreshWarning } from '@/components/feedback'
import { VehicleMultiSelect, type VehicleSelection } from '@/components/forms'
import { useDataState } from '@/hooks/useDataState'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import PackRulePreview from './PackRulePreview'
import PackDeliveryControls, { type PackDelivery } from './PackDeliveryControls'

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
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [master, setMaster] = useState<PackDelivery>({ cooldown_s: 3600, trigger_mode: 'once', include_title: true })
  const [selections, setSelections] = useState<Record<string, PackSelection>>(() => Object.fromEntries(pack.rules.map(template => [
    template.id, { template_id: template.id, value_num: template.rule.value_num ?? undefined,
      message: t(`alertPacks.rules.${template.id}.message`, template.rule.msg_template ?? '') },
  ])))
  const snapshot = JSON.stringify({ name, enabled, vehicleSelection, master, selected: [...selected].sort(), selections })
  const filtered = pack.rules.filter(template => `${t(`alertPacks.rules.${template.id}.name`, template.rule.name)} ${template.rule.signal_name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const initialSnapshot = useRef(snapshot)
  const hasUnsaved = snapshot !== initialSnapshot.current && !install.isSuccess
  useDirtyForm(hasUnsaved)
  useNavigationGuard(hasUnsaved, t('alertPacks.unsaved', 'You have an uninstalled alert pack configuration.'))
  const valid = (pack.id !== 'custom' || (name.trim().length > 0 && name.length <= 100)) && selected.length > 0 && (vehicleSelection.kind === 'all_sticky' || vehicleSelection.vehicle_ids.length > 0)
    && Number.isInteger(master.cooldown_s) && master.cooldown_s % 60 === 0 && master.cooldown_s >= 60 && master.cooldown_s <= 604800
    && selected.every(id => {
      const choice = selections[id]
      const template = pack.rules.find(item => item.id === id)
      const value = choice.value_num ?? template?.rule.value_num
      const numericValid = value == null || (Number.isFinite(value) && value >= (template?.unit === '%' ? 0 : -100) && value <= 100)
      return numericValid && Boolean(choice.message?.trim()) && (choice.message?.length ?? 0) <= 1024
        && (choice.cooldown_s == null || (Number.isInteger(choice.cooldown_s) && choice.cooldown_s % 60 === 0 && choice.cooldown_s >= 60 && choice.cooldown_s <= 604800))
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
            <GlassPanel className="space-y-3 p-4">
              <PanelTitle>{t('alertPacks.masterSettings', 'Master settings')}</PanelTitle>
              <Caption>{t('alertPacks.masterHelp', 'Rules follow these defaults unless you choose individual settings. Apply to all clears individual overrides; existing reused rules remain unchanged.')}</Caption>
              <PackDeliveryControls value={master} onChange={setMaster} disabled={install.isPending} master />
              <Toggle label={t('alertPacks.includeTitle', 'Include title in notifications')} checked={master.include_title} disabled={install.isPending}
                onChange={include_title => setMaster(previous => ({ ...previous, include_title }))} />
              <Button variant="secondary" disabled={install.isPending} onClick={() => setSelections(previous => Object.fromEntries(
                Object.entries(previous).map(([id, { cooldown_s: _cooldown, trigger_mode: _mode, include_title: _title, ...choice }]) => [id, choice]),
              ))}>{t('alertPacks.applyMaster', 'Apply master settings to all rules')}</Button>
            </GlassPanel>
            <SearchInput value={search} onChange={value => { setSearch(value); setPage(0) }} placeholder={t('alertPacks.searchRules', 'Search pack rules...')} />
            <div className="flex flex-wrap items-center gap-2">
              <Caption>{t('alertPacks.selectedCount', '{{selected}} of {{total}} rules selected', { selected: selected.length, total: pack.rules.length })}</Caption>
              <Button variant="ghost" disabled={install.isPending} onClick={() => setSelected(ids => [...new Set([...ids, ...filtered.map(rule => rule.id)])])}>{t('alertPacks.selectVisible', 'Select all matching rules')}</Button>
              <Button variant="ghost" disabled={install.isPending} onClick={() => setSelected(ids => ids.filter(id => !filtered.some(rule => rule.id === id)))}>{t('alertPacks.deselectVisible', 'Deselect matching rules')}</Button>
            </div>
            {filtered.slice(page * 10, (page + 1) * 10).map(template => (
              <PackRulePreview key={template.id} template={template} selection={selections[template.id]}
                master={master}
                selected={selected.includes(template.id)} disabled={install.isPending}
                onToggle={checked => setSelected(ids => checked ? [...ids, template.id] : ids.filter(id => id !== template.id))}
                onChange={choice => setSelections(previous => ({ ...previous, [template.id]: choice }))} />
            ))}
            {filtered.length === 0 && <Caption>{t('alertPacks.noMatchingRules', 'No matching rules. Clear the search to see the full pack.')}</Caption>}
            {filtered.length > 10 && <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{t('alertPacks.previous', 'Previous')}</Button>
              <Caption>{t('alertPacks.rulePage', 'Page {{page}} of {{total}}', { page: page + 1, total: Math.ceil(filtered.length / 10) })}</Caption>
              <Button variant="ghost" disabled={(page + 1) * 10 >= filtered.length} onClick={() => setPage(value => value + 1)}>{t('alertPacks.next', 'Next')}</Button>
            </div>}
            {install.error && <ErrorDisplay error={install.error} compact />}
            {!valid && <Caption>{t('alertPacks.invalid', 'Select at least one rule and a vehicle scope, and check message, threshold and cooldown values.')}</Caption>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!valid || vehicles.isLoading || Boolean(state.fatalError) || install.isPending} loading={install.isPending}
                onClick={() => install.mutate({
                  pack_id: pack.id, version: pack.version, enabled, ...master, name: pack.id === 'custom' ? name.trim() : undefined,
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
