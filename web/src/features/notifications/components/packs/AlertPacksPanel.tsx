import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAlertPacks, usePackInstallations, type AlertPack } from '@/api/hooks/useAlertPacks'
import { Button, Caption, GlassPanel, PanelTitle, SectionTitle, Text } from '@/components/ui'
import { SearchInput } from '@/components/forms'
import { EmptyState, ErrorDisplay, Spinner, StaleRefreshWarning } from '@/components/feedback'
import { useDataState } from '@/hooks/useDataState'
import InstallPackDialog from './InstallPackDialog'
import InstalledPackCard from './InstalledPackCard'
import { AIAlertPackBuilder } from '@/components/ai/AIAlertPackBuilder'

interface Props {
  onEditRule: (id: number) => void
}

export default function AlertPacksPanel({ onEditRule }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AlertPack | null>(null)
  const catalog = useAlertPacks()
  const installations = usePackInstallations(page)
  const catalogState = useDataState(catalog)
  const installationState = useDataState(installations)
  const packs = catalog.data ?? []
  const installed = installations.data ?? []
  const packName = (pack: AlertPack) => t(`alertPacks.catalog.${pack.id}.name`, pack.name)
  const filtered = packs.filter(pack => `${packName(pack)} ${t(`alertPacks.catalog.${pack.id}.description`, pack.description)}`
    .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return (
    <GlassPanel className="space-y-5 p-4 sm:p-5">
      <SectionTitle>{t('alertPacks.title', 'Alert Packs')}</SectionTitle>
      <Text>{t('alertPacks.intro', 'Start with a goal, not a blank rule. Preview a curated group, choose your vehicles and install ordinary, independently editable rules.')}</Text>
      <SearchInput value={search} onChange={setSearch} placeholder={t('alertPacks.search', 'Search packs...')} />
      {catalog.isLoading ? <Spinner /> : catalogState.fatalError ? <ErrorDisplay error={catalogState.fatalError} onRetry={() => void catalog.refetch()} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(pack => (
            <GlassPanel key={pack.id} className="flex flex-col gap-3 p-4">
              <PanelTitle>{packName(pack)}</PanelTitle>
              <Text variant="bodySm">{t(`alertPacks.catalog.${pack.id}.description`, pack.description)}</Text>
              <Caption className="mt-auto">{t('alertPacks.ruleCount', '{{count}} rules · version {{version}}', { count: pack.rules.length, version: pack.version })}</Caption>
              <Button variant="secondary" onClick={() => setSelected(pack)} aria-label={t('alertPacks.preview', 'Preview {{name}}', { name: packName(pack) })}>
                {t('alertPacks.previewAction', 'Preview pack')}
              </Button>
            </GlassPanel>
          ))}
          {filtered.length === 0 && <EmptyState title={t('alertPacks.noMatches', 'No matching packs')} message={t('alertPacks.trySearch', 'Try another search or clear the filter.')}
            action={{ label: t('alertPacks.clear', 'Clear search'), onClick: () => setSearch('') }} />}
        </div>
      )}
      <StaleRefreshWarning state={catalogState} />
      {packs.find(pack => pack.id === 'custom') && <AIAlertPackBuilder
        catalog={packs.find(pack => pack.id === 'custom')!} onApply={setSelected} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>{t('alertPacks.installedTitle', 'Installed packs')}</SectionTitle>
        <Button variant="ghost" loading={installations.isFetching} onClick={() => void installations.refetch()}>{t('alertPacks.refresh', 'Refresh')}</Button>
      </div>
      {installations.isLoading ? <Spinner /> : installationState.fatalError ? <ErrorDisplay error={installationState.fatalError} onRetry={() => void installations.refetch()} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {installed.map(item => <InstalledPackCard key={item.id} installation={item}
            name={packs.find(pack => pack.id === item.pack_id) ? packName(packs.find(pack => pack.id === item.pack_id)!) : item.name}
            onEditRule={onEditRule} />)}
          {/* no-action: pack preview and installation actions are directly above. */}
          {installed.length === 0 && <EmptyState title={t('alertPacks.noneInstalled', 'No packs on this page')}
            message={t('alertPacks.choosePack', 'Preview a pack above to get started. Existing rules and templates are unchanged.')} />}
        </div>
      )}
      <StaleRefreshWarning state={installationState} />
      <div className="flex gap-2">
        <Button variant="ghost" disabled={page === 0 || installations.isFetching} onClick={() => setPage(value => value - 1)}>{t('alertPacks.previous', 'Previous')}</Button>
        <Button variant="ghost" disabled={installed.length < 20 || installations.isFetching} onClick={() => setPage(value => value + 1)}>{t('alertPacks.next', 'Next')}</Button>
      </div>
      {selected && <InstallPackDialog key={selected.id} pack={selected} onClose={() => setSelected(null)} />}
    </GlassPanel>
  )
}
