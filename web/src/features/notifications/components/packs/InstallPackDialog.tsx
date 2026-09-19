import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AlertPack, type PackSelection, type PackTemplate, useInstallAlertPack } from '@/api/hooks/useAlertPacks'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useNotificationChannels } from '@/api/hooks/useNotifications'
import { Accordion, Badge, Button, Caption, Checkbox, DataTable, Input, Modal, PanelTitle, Select, Text, type Column } from '@/components/ui'
import { SearchInput, VehicleMultiSelect, type VehicleSelection } from '@/components/forms'
import { SeverityBadge } from '@/components/data-display'
import { AlertBanner, ErrorDisplay, Spinner, StaleRefreshWarning } from '@/components/feedback'
import { useDataState } from '@/hooks/useDataState'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { Icons } from '@/lib/icons'
import PackRulePreview from './PackRulePreview'
import PackRuleTriggerEditor from './PackRuleTriggerEditor'
import PackRuleDeliveryEditor from './PackRuleDeliveryEditor'
import PackRuleMessageEditor from './PackRuleMessageEditor'
import PackRuleChannels from './PackRuleChannels'
import PackRuleResetButton from './PackRuleResetButton'
import PackDeliveryControls, { type PackDelivery } from './PackDeliveryControls'

interface Props {
  pack: AlertPack
  onClose: () => void
}

export default function InstallPackDialog({ pack, onClose }: Props) {
  const { t } = useTranslation()
  const vehicles = useVehicles()
  const state = useDataState(vehicles)
  const channels = useNotificationChannels()
  const channelState = useDataState(channels)
  const install = useInstallAlertPack()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const vehicleId = useId()
  const [vehicleSelection, setVehicleSelection] = useState<VehicleSelection>({ kind: 'all_sticky' })
  const [enabled, setEnabled] = useState(false)
  const [name, setName] = useState(pack.id === 'custom' ? pack.name : '')
  const [discard, setDiscard] = useState(false)
  const [selected, setSelected] = useState(() => pack.rules.map(rule => rule.id))
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')
  const [page, setPage] = useState(0)
  const [master, setMaster] = useState<PackDelivery>({ cooldown_s: 3600, trigger_mode: 'once', include_title: true })
  const [selections, setSelections] = useState<Record<string, PackSelection>>(() => Object.fromEntries(pack.rules.map(template => [
    template.id, { template_id: template.id, op: template.rule.op, channel_ids: template.rule.channel_ids ?? null, value_num: template.rule.value_num ?? undefined,
      message: t(`alertPacks.rules.${template.id}.message`, template.rule.msg_template ?? '') },
  ])))
  const initialSelections = useRef(selections)
  const customized = useMemo(() => new Set(Object.keys(selections).filter(id =>
    JSON.stringify(selections[id]) !== JSON.stringify(initialSelections.current[id]))), [selections])
  const overrideCount = Object.values(selections).filter(choice =>
    choice.cooldown_s != null || choice.trigger_mode != null || choice.include_title != null).length
  const snapshot = JSON.stringify({ name, enabled, vehicleSelection, master, selected: [...selected].sort(), selections })
  const initialSnapshot = useRef(snapshot)
  const hasUnsaved = snapshot !== initialSnapshot.current && !install.isSuccess
  useDirtyForm(hasUnsaved)
  useNavigationGuard(hasUnsaved, t('alertPacks.unsaved', 'You have an uninstalled alert pack configuration.'))
  const filtered = pack.rules.filter(template =>
    `${t(`alertPacks.rules.${template.id}.name`, template.rule.name)} ${template.rule.signal_name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && (view !== 'selected' || selected.includes(template.id)) && (view !== 'customized' || customized.has(template.id)))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1))
  const visible = filtered.slice(currentPage * 10, (currentPage + 1) * 10)
  const allMatchingSelected = filtered.length > 0 && filtered.every(rule => selected.includes(rule.id))
  const valid = (pack.id !== 'custom' || (name.trim().length > 0 && name.length <= 100)) && selected.length > 0
    && (vehicleSelection.kind === 'all_sticky' || vehicleSelection.vehicle_ids.length > 0)
    && Number.isInteger(master.cooldown_s) && master.cooldown_s % 60 === 0 && master.cooldown_s >= 60 && master.cooldown_s <= 604800
    && selected.every(id => {
      const choice = selections[id]
      const template = pack.rules.find(item => item.id === id)
      const value = choice.value_num ?? template?.rule.value_num
      return (value == null || (Number.isFinite(value) && value >= (template?.unit === '%' ? 0 : -100) && value <= 100))
        && Boolean(choice.message?.trim()) && (choice.message?.length ?? 0) <= 1024
        && (choice.cooldown_s == null || (Number.isInteger(choice.cooldown_s) && choice.cooldown_s % 60 === 0 && choice.cooldown_s >= 60 && choice.cooldown_s <= 604800))
    })
  const close = () => {
    if (install.isPending) return
    if (hasUnsaved) setDiscard(true)
    else onClose()
  }
  const toggleRule = (id: string, checked: boolean) =>
    setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id))
  const ruleProps = (template: PackTemplate) => ({
    template, selection: selections[template.id], master, customized: customized.has(template.id),
    selected: selected.includes(template.id), disabled: install.isPending, channels: channels.data ?? [],
    onToggle: (checked: boolean) => toggleRule(template.id, checked),
    onChange: (choice: PackSelection) => setSelections(previous => ({ ...previous, [template.id]: choice })),
  })
  const columns: Column<PackTemplate>[] = [
    { key: 'selection', header: t('alertPacks.selected', 'Selected'), align: 'left', className: 'w-16', render: template => <div className="flex h-11 items-center">
      <Checkbox aria-label={t(`alertPacks.rules.${template.id}.name`, template.rule.name)}
        checked={selected.includes(template.id)} disabled={install.isPending} onChange={checked => toggleRule(template.id, checked)} /></div> },
    { key: 'rule', header: t('alertPacks.rule', 'Rule'), align: 'left', className: 'min-w-48 max-w-60 whitespace-normal', render: template => <div className="min-w-0 space-y-1">
      <Text as="p" variant="bodySm" weight="medium">
        {t(`alertPacks.rules.${template.id}.name`, template.rule.name)}
      </Text>
      <div className="flex flex-wrap gap-1">
        <SeverityBadge severity={template.rule.severity} size="sm" />
        {customized.has(template.id) && <Badge variant="info" size="sm">{t('alertPacks.customized', 'Customized')}</Badge>}
      </div>
    </div> },
    { key: 'operator', header: t('alertPacks.operator', 'Operator'), align: 'left', className: 'min-w-32 w-32', render: template =>
      <PackRuleTriggerEditor {...ruleProps(template)} field="operator" compact /> },
    { key: 'value', header: t('alertPacks.valueColumn', 'Value'), align: 'left', className: 'min-w-32 w-32', render: template =>
      <PackRuleTriggerEditor {...ruleProps(template)} field="value" compact /> },
    { key: 'cooldown', header: t('alertPacks.cooldownCompact', 'Cooldown (min)'), align: 'left', className: 'min-w-32 w-32', render: template =>
      <PackRuleDeliveryEditor {...ruleProps(template)} field="cooldown" compact /> },
    { key: 'behavior', header: t('alertPacks.behavior', 'Alert behavior'), align: 'left', className: 'min-w-48 w-48', render: template =>
      <PackRuleDeliveryEditor {...ruleProps(template)} field="behavior" compact /> },
    { key: 'channels', header: t('alertPacks.channels', 'Channels'), align: 'left', className: 'min-w-56 w-56 whitespace-normal', render: template => <PackRuleChannels
      id={template.id} value={selections[template.id].channel_ids ?? null} channels={channels.data ?? []} disabled={install.isPending || channels.isLoading} compact
      onChange={channel_ids => ruleProps(template).onChange({ ...selections[template.id], channel_ids })} /> },
    { key: 'message', header: t('alertPacks.message', 'Notification message'), align: 'left', className: 'min-w-80 whitespace-normal', render: template => <PackRuleMessageEditor {...ruleProps(template)} compact /> },
    { key: 'title', header: t('alertPacks.titleColumn', 'Include title'), align: 'left', className: 'w-24', render: template =>
      <PackRuleDeliveryEditor {...ruleProps(template)} field="title" compact /> },
    { key: 'defaults', header: t('alertPacks.defaultsColumn', 'Defaults'), align: 'left', className: 'w-16', render: template =>
      <PackRuleResetButton {...ruleProps(template)} /> },
  ]
  const settings = <div className="space-y-3">
    <div data-pack-default-controls className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(7rem,1fr)_minmax(11rem,1.3fr)_minmax(7rem,1fr)_minmax(12rem,1.5fr)_minmax(13rem,1.5fr)]">
    <PackDeliveryControls value={master} onChange={setMaster} disabled={install.isPending} />
    <div className="space-y-1">
      <label htmlFor={vehicleId} className="flex items-center"><Text size="sm" weight="medium" color="secondary">{t('alertPacks.vehicles', 'Vehicles')}</Text></label>
      {vehicles.isLoading ? <Spinner /> : state.fatalError ? <ErrorDisplay error={state.fatalError} onRetry={() => void vehicles.refetch()} />
        : <VehicleMultiSelect id={vehicleId} vehicles={vehicles.data ?? []} value={vehicleSelection} disabled={install.isPending} onChange={setVehicleSelection}
          className="[&>button]:h-11 [&>button]:rounded-shape-md [&>button]:border-[var(--control-border)] [&>button]:bg-[var(--control-bg)]" />}
      <StaleRefreshWarning state={state} />
    </div>
    <Select label={t('alertPacks.afterInstall', 'After installation')} value={enabled ? 'enabled' : 'paused'} disabled={install.isPending} className="h-11"
      options={[{ value: 'paused', label: t('alertPacks.keepPaused', 'Keep paused (recommended)') },
        { value: 'enabled', label: t('alertPacks.enableImmediately', 'Enable immediately') }]}
      onChange={event => setEnabled(event.target.value === 'enabled')} />
    </div>
    <div className="flex flex-wrap items-start gap-2">
      <Caption className="min-w-48 flex-1">{t('alertPacks.masterHelp', 'Rows follow these defaults until you edit them. Reset delivery to follow the defaults again.')}</Caption>
      {overrideCount > 0 && <Button variant="secondary" size="sm" className="h-auto min-h-11 whitespace-normal" disabled={install.isPending}
        onClick={() => setSelections(previous => Object.fromEntries(Object.entries(previous).map(
          ([id, { cooldown_s: _cooldown, trigger_mode: _mode, include_title: _title, ...choice }]) => [id, choice],
        )))}>{t('alertPacks.applyMaster', 'Apply defaults to all rules')}</Button>}
    <Accordion title={t('alertPacks.howInstallWorks', 'How installation works')} className="max-w-full" headerClassName="px-2 py-1" bodyClassName="max-w-prose space-y-3 p-3">
      <Text as="p" variant="bodySm">{t(`alertPacks.catalog.${pack.id}.description`, pack.description)}</Text>
      <Caption className="block">{t('alertPacks.delivery', 'Uses your existing notification channels, preferences and quiet hours. No vehicle commands are sent. Telemetry availability varies by vehicle.')}</Caption>
      <Caption className="block">{t('alertPacks.duplicates', 'Matching triggers for the same vehicle selection are reused unchanged, even if disabled. Different thresholds or overlapping vehicle selections may still produce similar notifications.')}</Caption>
      <Caption className="block">{t('alertPacks.disabledDefault', 'New rules are disabled by default so you can review them. Existing rules keep their current enabled state.')}</Caption>
      <Caption className="block">{master.trigger_mode === 'once'
        ? t('alertPacks.once', 'Fires once when the condition becomes true; resets when it becomes false. Changed-value rules fire on each change, subject to cooldown.')
        : t('alertPacks.repeat', 'Repeats while the condition remains true, no more often than the cooldown. Changed-value rules still require a new change.')}</Caption>
    </Accordion>
    </div>
  </div>
  const result = install.data
  return (
    <Modal open onClose={close} size="full" className="sm:max-w-[96vw]" title={t('alertPacks.preview', 'Preview {{name}}', { name: pack.id === 'custom' ? name : t(`alertPacks.catalog.${pack.id}.name`, pack.name) })}
      footer={result ? <Button onClick={onClose}>{t('alertPacks.done', 'Done')}</Button> : <div className="space-y-2">
        {install.error && <ErrorDisplay error={install.error} compact />}
        {!valid && <Caption className="block">{t('alertPacks.invalid', 'Select at least one rule and a vehicle scope, and check message, threshold and cooldown values.')}</Caption>}
        {discard ? <AlertBanner variant="warning">
          <Text as="p">{t('alertPacks.discard', 'Discard this pack configuration? No rules have been installed.')}</Text>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" onClick={onClose}>{t('alertPacks.discardConfirm', 'Discard configuration')}</Button>
            <Button variant="ghost" onClick={() => setDiscard(false)}>{t('alertPacks.keepEditing', 'Keep editing')}</Button>
          </div>
        </AlertBanner> : <div className="flex flex-wrap items-center justify-between gap-3">
          <div aria-live="polite">
            <Text as="p" variant="bodySm" weight="medium">{t('alertPacks.selectedCount', '{{selected}} of {{total}} rules selected', { selected: selected.length, total: pack.rules.length })}</Text>
            <Caption className="block">{enabled ? t('alertPacks.enabledSummary', 'New rules will be enabled') : t('alertPacks.pausedSummary', 'New rules will be paused for review')}</Caption>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={close} disabled={install.isPending}>{t('alertPacks.cancel', 'Cancel')}</Button>
            <Button aria-label={t('alertPacks.install', 'Install selected rules')} disabled={!valid || vehicles.isLoading || Boolean(state.fatalError) || install.isPending}
              loading={install.isPending} onClick={() => install.mutate({
                pack_id: pack.id, version: pack.version, enabled, ...master, name: pack.id === 'custom' ? name.trim() : undefined,
                all_vehicles: vehicleSelection.kind === 'all_sticky',
                vehicle_ids: vehicleSelection.kind === 'specific' ? vehicleSelection.vehicle_ids : [],
                rules: selected.map(id => selections[id]),
              })}>{t('alertPacks.installCount', 'Install {{count}} rules', { count: selected.length })}</Button>
          </div>
        </div>}
      </div>}>
      {result ? <div className="space-y-3">
        <AlertBanner variant="success">{t('alertPacks.installed', 'Pack installed. Created {{created}} rules; reused {{reused}} existing rules without changing them.', {
          created: result.members.filter(member => member.owned).length, reused: result.members.filter(member => !member.owned).length,
        })}</AlertBanner>
        {result.members.map(member => <Text as="p" key={member.template_id} variant="bodySm">{member.name} — {member.owned
          ? t('alertPacks.created', 'Created') : t('alertPacks.reused', 'Existing rule kept unchanged')}{!member.enabled ? ` (${t('alertPacks.disabled', 'disabled')})` : ''}</Text>)}
      </div> : <div className="space-y-4">
        {pack.id === 'custom' && <Input label={t('alertPacks.packName', 'Pack name')} value={name} maxLength={100} disabled={install.isPending} onChange={e => setName(e.target.value)} />}
        <div className="min-w-0 space-y-4">
          {desktop ? <section aria-label={t('alertPacks.masterSettings', 'Pack defaults')} className="space-y-3 self-start rounded-lg bg-[var(--surface-2)] p-4">
            <PanelTitle>{t('alertPacks.masterSettings', 'Pack defaults')}</PanelTitle>{settings}
          </section> : <Accordion title={t('alertPacks.masterSettings', 'Pack defaults')} icon={<Icons.settings className="h-4 w-4" />}
            className="border-[var(--border-default)] bg-[var(--surface-2)]"
            badge={<Badge>{t('alertPacks.cooldownSummary', '{{minutes}} min', { minutes: Number.isFinite(master.cooldown_s) ? master.cooldown_s / 60 : '—' })}</Badge>}>
            {settings}
          </Accordion>}
          <section aria-label={t('alertPacks.chooseRules', 'Choose rules')} className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <PanelTitle>{t('alertPacks.chooseRules', 'Choose rules')}</PanelTitle>
              <Caption className="block">{t('alertPacks.chooseBrief', 'Edit fields directly. Focus a message to read more. Nothing is saved until you install.')}</Caption>
            </div>
            {channels.isLoading && <Spinner />}
            {channelState.fatalError && <ErrorDisplay error={channelState.fatalError} onRetry={() => void channels.refetch()} />}
            {!channels.isLoading && !channelState.fatalError && channels.data?.length === 0 && <Caption className="block">{t('alertPacks.noConfiguredChannels', 'No external channels configured.')}</Caption>}
            <StaleRefreshWarning state={channelState} />
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox label={t('alertPacks.selectAll', 'Select all')} aria-label={t('alertPacks.selectVisible', 'Select all matching rules')}
                checked={allMatchingSelected} indeterminate={!allMatchingSelected && filtered.some(rule => selected.includes(rule.id))}
                disabled={install.isPending || filtered.length === 0} onChange={checked => setSelected(ids => checked
                  ? [...new Set([...ids, ...filtered.map(rule => rule.id)])] : ids.filter(id => !filtered.some(rule => rule.id === id)))} />
              <div className="min-w-40 flex-1">
                <SearchInput value={search} onChange={value => { setSearch(value); setPage(0) }} placeholder={t('alertPacks.searchRules', 'Search pack rules...')} />
              </div>
              <Select aria-label={t('alertPacks.showRules', 'Show rules')} value={view} onChange={event => { setView(event.target.value); setPage(0) }}
                options={[{ value: 'all', label: t('alertPacks.allRules', 'All rules') },
                  { value: 'selected', label: t('alertPacks.selected', 'Selected') },
                  { value: 'customized', label: t('alertPacks.customized', 'Customized') }]} />
              <Caption>{t('alertPacks.showingRules', '{{count}} matching rules', { count: filtered.length })}</Caption>
            </div>
            {desktop ? <DataTable tableId="notifications:pack-preview" caption={t('alertPacks.chooseRules', 'Choose rules')} columns={columns} density="compact"
              data={visible} keyExtractor={template => template.id} className="[&_td]:align-top [&_th]:whitespace-nowrap [&_th]:text-left"
              mobileColumns={columns.map(column => column.key)} />
              : <div className="space-y-2">{visible.map(template => <PackRulePreview key={template.id} {...ruleProps(template)} />)}</div>}
            {filtered.length === 0 && <div className="space-y-2 rounded-lg border border-[var(--border-default)] p-4">
              <Caption className="block">{t('alertPacks.noMatchingRules', 'No matching rules. Clear the search to see the full pack.')}</Caption>
              <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setView('all'); setPage(0) }}>{t('alertPacks.clearFilters', 'Clear filters')}</Button>
            </div>}
            {filtered.length > 10 && <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('alertPacks.previous', 'Previous')}</Button>
              <Caption>{t('alertPacks.rulePage', 'Page {{page}} of {{total}}', { page: currentPage + 1, total: Math.ceil(filtered.length / 10) })}</Caption>
              <Button variant="ghost" disabled={(currentPage + 1) * 10 >= filtered.length} onClick={() => setPage(currentPage + 1)}>{t('alertPacks.next', 'Next')}</Button>
            </div>}
          </section>
        </div>
      </div>}
    </Modal>
  )
}
