import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DataState } from '@/api/dataState'
import type { AuthModeResponse } from '@/api/types'
import { useSetSmartFeature, useSmartFeatures, type SmartFeaturePreference } from '@/api/hooks/useSmartFeatures'
import { personalScope, usePersonalIdentity, type PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { DataStateNotice, EmptyState, QueryError } from '@/components/feedback'
import { PageLayout, PrefetchLink } from '@/components/layout'
import { DataTable, GlassPanel, Text, Toggle, type Column } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { usePageTitle } from '@/hooks/usePageTitle'
import { smartFeatureCatalog, type SmartFeatureDefinition } from '../components/smart-features/catalog'

type Row = SmartFeatureDefinition & SmartFeaturePreference

export default function SmartFeaturesPage() {
  const identity = usePersonalIdentity()
  const account = useDataState(identity)
  const scope = account.data?.impersonating ? null : personalScope(account.data)
  return <SmartFeatureSettings key={JSON.stringify(scope)} scope={scope} account={account} loading={identity.isLoading} />
}

function SmartFeatureSettings({ scope, account, loading }: {
  scope: PersonalScope | null
  account: DataState<AuthModeResponse>
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  const title = t('settings.smartFeatures.title', 'Smart Features')
  usePageTitle(title)
  const preferences = useDataState(useSmartFeatures(scope))
  const { mutate, isPending, variables, error: saveError, reset } = useSetSmartFeature(scope)
  const [search, setSearch] = useState('')
  const catalog = smartFeatureCatalog(t)
  const rows = (preferences.data ?? []).flatMap<Row>(pref => {
    const definition = catalog.get(pref.feature)
    return definition ? [{ ...pref, ...definition }] : []
  })
  const groupLabels: Record<Row['group'], string> = {
    charging: t('settings.smartFeatures.groups.charging', 'Charging'),
    battery: t('settings.smartFeatures.groups.battery', 'Battery'),
    climate: t('settings.smartFeatures.groups.climate', 'Climate'),
    security: t('settings.smartFeatures.groups.security', 'Security & access'),
    maintenance: t('settings.smartFeatures.groups.maintenance', 'Maintenance'),
    media: t('settings.smartFeatures.groups.media', 'Media'),
    ownership: t('settings.smartFeatures.groups.ownership', 'Ownership'),
    driving: t('settings.smartFeatures.groups.driving', 'Driving'),
    operations: t('settings.smartFeatures.groups.operations', 'Operations'),
  }
  const query = search.trim().toLocaleLowerCase(i18n.language)
  const filtered = rows.filter(row => [row.title, row.description, groupLabels[row.group]]
    .some(value => value.toLocaleLowerCase(i18n.language).includes(query)))
  const error = account.fatalError ?? preferences.fatalError
  const canSave = !isPending && account.status === 'ok' && preferences.status === 'ok'
  const label = t('settings.smartFeatures.permission', 'Permission')
  const stateLabel = (allowed: boolean) => allowed
    ? t('settings.smartFeatures.allowed', 'Allowed')
    : t('settings.smartFeatures.paused', 'Paused')
  const permission = (row: Row) => (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Toggle checked={row.allowed}
        disabled={!canSave}
        focusableWhenDisabled
        aria-label={t('settings.smartFeatures.switchFor', 'Allow {{feature}}', { feature: row.title })}
        onChange={allowed => mutate({ feature: row.feature, allowed })} />
      <Text as="span" size="sm" aria-live="polite">
        {isPending && variables?.feature === row.feature ? t('settings.smartFeatures.saving', 'Saving…') : stateLabel(row.allowed)}
      </Text>
    </div>
  )
  const setup = (row: Row) => (
    <PrefetchLink
      to={row.path}
      className="inline-flex min-h-11 items-center rounded-shape-md px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
      aria-label={t('settings.smartFeatures.setupFor', 'Setup for {{feature}}', { feature: row.title })}
    >
      <Text size="sm" weight="semibold">{t('settings.smartFeatures.openSetup', 'Open setup')}</Text>
    </PrefetchLink>
  )
  const columns: Column<Row>[] = [
    {
      key: 'feature', header: t('settings.smartFeatures.feature', 'Feature'), required: true, pinned: true,
      sortValue: row => row.title,
      render: row => <div className="space-y-1">
        <Text as="p" weight="semibold">{row.title}</Text>
        <Text as="p" variant="bodySm">{row.description}</Text>
      </div>,
    },
    {
      key: 'allowed', header: label, required: true, fixedWidth: 180, groupStart: true,
      filterValue: row => String(row.allowed), filterValueLabel: (_, row) => stateLabel(row.allowed),
      sortValue: row => stateLabel(row.allowed), render: permission,
    },
    { key: 'setup', header: t('settings.smartFeatures.setup', 'Setup'), fixedWidth: 155, render: setup },
  ]
  return (
    <PageLayout title={title} copyLink
      subtitle={t('settings.smartFeatures.subtitle', 'Allow or pause individual recommendations and reminders.')}
      loading={loading || (scope !== null && !error && preferences.status === 'initial')}
    >
      <GlassPanel className="space-y-2 p-4">
        <Text as="p">{t('settings.smartFeatures.explanation', 'Allowing a feature does not set it up, grant Fleet API access, or enable notifications. Pausing stops new smart work and delivery without deleting your setup or history.')}</Text>
        {scope?.mode === 'open' && <Text as="p" variant="bodySm">
          {t('settings.smartFeatures.shared', 'Without sign-in, these preferences apply to everyone using this server. Private features require sign-in.')}
        </Text>}
      </GlassPanel>
      {error && <QueryError error={error} onRetry={(account.fatalError ? account.retry : preferences.retry) ?? undefined} />}
      {/* no-action: The external authentication provider owns sign-in and impersonation recovery. */}
      {scope === null && account.hasData && <EmptyState message={t('settings.smartFeatures.identityRequired', 'Sign in to manage your Smart Features.')} />}
      {scope !== null && !error && <>
        {(account.status === 'stale' || preferences.status === 'stale') && <DataStateNotice state="stale" />}
        {saveError && <QueryError compact error={saveError}
          message={t('settings.smartFeatures.saveFailed', 'Could not save that permission. The last verified setting is shown.')}
          onRetry={canSave && variables ? () => { reset(); mutate(variables) } : undefined} />}
        <DataTable
          name={title}
          tableId="settings-smart-features"
          columns={columns}
          data={filtered}
          keyExtractor={row => row.feature}
          rowLabel={row => row.title}
          controls={{ search: {
            value: search,
            onChange: setSearch,
            ariaLabel: t('settings.smartFeatures.search', 'Search Smart Features'),
            placeholder: t('settings.smartFeatures.search', 'Search Smart Features'),
          } }}
          rowGrouping={{ key: row => row.group, label: key => groupLabels[key as Row['group']] ?? key, autoExpand: true }}
          enableValueFilters
          showMatchingCount
          showDensityControl
          mobilePresentation={{
            roles: { feature: 'title' },
            displayValue: row => row.title,
            columnToolsInPicker: true,
            compactRows: true,
            inlineActions: (row, visible) => <>
              <Text as="p" variant="bodySm" className="w-full">{row.description}</Text>
              {permission(row)}
              {visible.has('setup') && setup(row)}
            </>,
          }}
          emptyMessage={rows.length === 0
            ? t('settings.smartFeatures.unavailable', 'No Smart Features are available for this account.')
            : t('settings.smartFeatures.noMatches', 'No Smart Features match these filters.')}
        />
      </>}
    </PageLayout>
  )
}
