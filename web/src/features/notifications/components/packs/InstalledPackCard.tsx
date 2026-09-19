import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type PackInstallation, useRemoveAlertPack } from '@/api/hooks/useAlertPacks'
import { Button, Caption, GlassPanel, Modal, PanelTitle, Text, Toggle } from '@/components/ui'
import { ErrorDisplay } from '@/components/feedback'
import { formatDateTime } from '@/lib/dateFormat'

interface Props {
  installation: PackInstallation
  name: string
  onEditRule: (id: number) => void
}

export default function InstalledPackCard({ installation, name, onEditRule }: Props) {
  const { t } = useTranslation()
  const remove = useRemoveAlertPack()
  const [confirm, setConfirm] = useState(false)
  const [deleteIDs, setDeleteIDs] = useState<number[]>([])
  return (
    <GlassPanel className="space-y-3 p-4">
      <PanelTitle>{name}</PanelTitle>
      <Caption>{t('alertPacks.installedVersion', 'Version {{version}} · installed {{date}}', { version: installation.version, date: formatDateTime(installation.created_at) })}</Caption>
      <Text variant="bodySm">{installation.scope_key === 'all'
        ? t('alertPacks.allVehicles', 'All current and future vehicles')
        : t('alertPacks.vehicleScope', 'Vehicle IDs: {{ids}}', { ids: installation.scope_key })}</Text>
      <Caption>{t('alertPacks.editIndividually', 'Rules remain independent. Edit, enable, disable or delete them in the existing rule editor. Pack updates never overwrite your changes.')}</Caption>
      {installation.members.map(member => (
        <div key={member.template_id} className="flex flex-wrap items-center justify-between gap-2">
          <Text variant="bodySm">{member.name} — {member.rule_id == null ? t('alertPacks.deleted', 'Deleted')
            : member.enabled ? t('alertPacks.enabled', 'Enabled') : t('alertPacks.disabled', 'disabled')}
            {!member.owned && ` (${t('alertPacks.reused', 'Existing rule kept unchanged')})`}
            {member.shared && ` (${t('alertPacks.shared', 'Shared with another pack')})`}
          </Text>
          {member.rule_id != null && <Button size="sm" variant="ghost" onClick={() => onEditRule(member.rule_id!)}
            aria-label={t('alertPacks.editRule', 'Edit {{name}}', { name: member.name })}>{t('alertPacks.edit', 'Edit rule')}</Button>}
        </div>
      ))}
      <Button variant="ghost" onClick={() => { setDeleteIDs([]); remove.reset(); setConfirm(true) }}>{t('alertPacks.remove', 'Remove pack')}</Button>
      <Modal open={confirm} onClose={() => { if (!remove.isPending) setConfirm(false) }} title={t('alertPacks.removeTitle', 'Remove {{name}}', { name })}>
        <div className="space-y-4">
          <Text>{t('alertPacks.removeHelp', 'By default, all rules are kept. Select only the rules you also want to delete, including any edits you made to them. Existing or shared rules cannot be deleted here.')}</Text>
          {installation.members.filter(member => member.owned && !member.shared && member.rule_id != null).map(member => (
            <Toggle key={member.template_id} label={member.name} checked={deleteIDs.includes(member.rule_id!)} disabled={remove.isPending}
              onChange={checked => setDeleteIDs(ids => checked ? [...ids, member.rule_id!] : ids.filter(id => id !== member.rule_id))} />
          ))}
          <Caption>{t('alertPacks.deleteCount', '{{count}} rules selected for deletion.', { count: deleteIDs.length })}</Caption>
          {remove.error && <ErrorDisplay error={remove.error} compact />}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={remove.isPending} loading={remove.isPending}
              onClick={() => remove.mutate({ id: installation.id, delete_rule_ids: deleteIDs }, { onSuccess: () => setConfirm(false) })}>
              {t('alertPacks.confirmRemove', 'Confirm removal')}
            </Button>
            <Button variant="ghost" disabled={remove.isPending} onClick={() => setConfirm(false)}>{t('alertPacks.cancel', 'Cancel')}</Button>
          </div>
        </div>
      </Modal>
    </GlassPanel>
  )
}
