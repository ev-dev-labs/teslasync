import { useTranslation } from 'react-i18next'
import { useBulkDeleteAlertRules } from '@/api/hooks/useBulkDeleteAlertRules'
import type { AlertRule, NotificationChannel } from '@/api/hooks/useNotifications'
import { Button, Checkbox, ConfirmDialog, Select, Caption } from '@/components/ui'
import { BulkActionsToolbar, type BulkAction } from '@/components/data-display'
import { SearchInput } from '@/components/forms'
import { ErrorDisplay } from '@/components/feedback'
import { useConfirm } from '@/hooks/useConfirm'
import { Icons } from '@/lib/icons'

interface Props {
  rules: AlertRule[]
  total: number
  search: string
  onSearch: (search: string) => void
  selected: Set<number>
  onSelect: (ids: Set<number>) => void
  channels: NotificationChannel[]
  channelFilter: string
  onChannelFilter: (filter: string) => void
  actions: BulkAction[]
  busy?: boolean
  beforeDelete: (ids: number[]) => Promise<boolean>
  onDeleted: (ids: number[]) => void
}

export default function RuleListTools({ rules, total, search, onSearch, selected, onSelect, channels, channelFilter, onChannelFilter, actions, busy = false, beforeDelete, onDeleted }: Props) {
  const { t } = useTranslation()
  const deletion = useBulkDeleteAlertRules()
  const { confirm, dialogProps } = useConfirm()
  const allSelected = rules.length > 0 && rules.every(rule => selected.has(rule.id))
  const pending = busy || deletion.isPending
  const remove = async (ids: number[]) => {
    if (pending || ids.length === 0 || !await beforeDelete(ids)) return
    const ok = await confirm({
      title: t('alertPacks.deleteRulesTitle', {
        count: ids.length, defaultValue: ids.length === 1 ? 'Delete {{count}} rule?' : 'Delete {{count}} rules?',
      }),
      message: t('alertPacks.deleteRulesHelp', 'This permanently deletes the chosen rules, including any edits. Pack membership will be updated. Rules outside this selection are kept.'),
      confirmLabel: t('common.delete', 'Delete'),
      variant: 'danger',
    })
    if (ok) {
      await deletion.mutateAsync(ids)
      onDeleted(ids)
    }
  }
  if (total === 0) return null
  return (
    <div className="@container mb-3 space-y-2">
      <div className="grid min-w-0 grid-cols-1 gap-2 @sm:grid-cols-2">
        <fieldset disabled={pending} className="min-w-0">
          <SearchInput value={search} onChange={onSearch}
            placeholder={t('notifications.alertStudio.rules.searchPlaceholder', 'Search rules...')}
            aria-label={t('notifications.alertStudio.rules.searchPlaceholder', 'Search rules...')} />
        </fieldset>
        <Select aria-label={t('alertPacks.channelFilter', 'Filter by notification channel')} value={channelFilter}
          onChange={e => onChannelFilter(e.target.value)} disabled={pending}
          options={[
            { value: '', label: t('alertPacks.filterAllChannels', 'All channels') },
            { value: 'all', label: t('alertPacks.filterAutomatic', 'Automatic routing') },
            { value: 'none', label: t('alertPacks.noExternal', 'No external channels') },
            ...channels.map(channel => ({ value: String(channel.id), label: channel.name })),
          ]} />
      </div>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Checkbox label={t('alertPacks.selectAll', 'Select all')}
          aria-label={t('alertPacks.selectAllRules', 'Select all matching rules')}
          checked={allSelected} indeterminate={selected.size > 0 && !allSelected} disabled={pending || rules.length === 0}
          onChange={checked => onSelect(checked ? new Set(rules.map(rule => rule.id)) : new Set())} />
        <div className="flex flex-wrap items-center gap-2">
          <Caption>{t('alertPacks.matchingCount', '{{count}} of {{total}}', { count: rules.length, total })}</Caption>
          {(search || channelFilter) && <Button variant="ghost" size="sm" disabled={pending}
            onClick={() => { onSearch(''); onChannelFilter('') }}>
            {t('alertPacks.clearFilters', 'Clear filters')}
          </Button>}
        </div>
      </div>
      <BulkActionsToolbar selectedIds={Array.from(selected)} onClear={() => onSelect(new Set())}
        className="static z-auto mb-0"
        actions={[
          ...actions.map(action => ({ ...action, disabled: pending || action.disabled })),
          { id: 'delete', label: t('common.delete', 'Delete'), variant: 'danger', icon: <Icons.delete className="h-3.5 w-3.5" />,
            disabled: pending, onClick: ids => remove(ids.map(Number)) },
        ]} />
      {deletion.error && <ErrorDisplay error={deletion.error} compact />}
      {dialogProps && <ConfirmDialog {...dialogProps} loading={deletion.isPending} />}
    </div>
  )
}
