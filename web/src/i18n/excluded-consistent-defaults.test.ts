import { createHash } from 'node:crypto'
import { createInstance } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import catalog from './en.json'
import baseline from './known-missing-keys.json'
import runtimeManifest from './en/runtime-manifest.json'
import usageManifest from './en/usage-manifest.json'
import shell from './en/shell.json'

type Json = Record<string, unknown>

const additions = [
  ['progressRing.ariaLabel', 'Progress: {{percent}}%'],
  ['demoMode.label', 'DEMO DATA — synthetic sample, not your vehicle'],
  ['signalConfig.deselectCategory', 'Deselect all {{category}} signals'],
  ['signalConfig.selectCategory', 'Select all {{category}} signals'],
  ['signalConfig.setCategoryInterval', 'Set interval for all {{category}} signals'],
  ['admin.slowQueries.kpiAnalyzedSub', 'Top {{limit}} by {{metric}}'],
  ['admin.security.brief.scope', 'Vehicle {{vehicle}} · History {{start}} to {{end}} (exclusive). Current status comes from a separate latest-state query.'],
  ['admin.diskForecast.tableCount', '{{count}} hypertables'],
  ['admin.teslaOrders.card.aria', '{{model}} order, {{status}}'],
  ['widget.backupHistory.summaryScope', 'Energy site {{siteId}}; history since {{since}}, no explicit exclusive end bound'],
  ['widget.energyStats.summary.scope', 'Vehicle {{id}} · source period {{days}} days'],
  ['widget.fsdWeekly.summary.scope', 'Vehicle {{id}} · {{start}} to {{end}} exclusive · {{timezone}}'],
  ['widget.lifetimeStats.summary.scope', 'Vehicle {{id}} · lifetime'],
  ['widget.mileageStats.summary.scope', 'Vehicle {{id}} · rolling 30 days / lifetime'],
  ['widget.speedHeatmap.gridLabel', 'Average speed by day of week and hour of day'],
  ['widget.yearReview.summary.scope', 'Vehicle {{id}} · year {{year}}'],
  ['physicsLedger.drive.empty', 'No drive interval in this window.'],
  ['driving.brief.awaiting', 'Awaiting evidence'],
  ['driveScore.brief.average', 'Average computed score for the returned scored-drive cohort, on a 0–100 scale.'],
  ['driveScore.brief.best', 'Highest computed score among the returned scored drives, on a 0–100 scale.'],
  ['driveScore.brief.count', 'Returned scored drives, not the independent server score total.'],
  ['driveScore.brief.efficiency', 'Average consumption in the returned scored-drive cohort.'],
  ['driveScore.brief.description', 'Computed driving scores and consumption retain their source cohort; the overall score gauge uses its independent assessment source.'],
  ['driveScore.brief.scope', 'Returned scored-drive subset in the selected period; independent score-assessment coverage may differ'],
  ['driveScore.brief.source', 'Computed scored-drive cohort; the retained trend label comes from the independent score assessment.'],
  ['coldStart.brief.window', '{{start}}–{{end}}; returned selected-window drives'],
  ['driving.brief.window', '{{start}}–{{end}}; returned drive subset, not a server-wide aggregate'],
  ['rhythm.brief.window', '{{start}}–{{end}} · {{timezone}}'],
  ['fsd.brief.window', '{{start}}–{{end}} (exclusive end) · {{timezone}}'],
  ['notifications.channels.providers.subtitle', '{{inUse}} of {{total}} provider types in use'],
  ['notifications.channels.providers.configured', '{{count}} configured'],
  ['fleetSetup.progress.token.title', 'Keep the Fleet token fresh'],
  ['search.entries.fleet.setup.desc', 'Connect Tesla, keep the Fleet token fresh, subscribe telemetry on a vehicle, and confirm streaming.'],
  ['search.entries.workspace.persona.desc', 'Prioritize navigation for an owner, fleet operator, analyst, or administrator.'],
  ['search.entries.workspace.landing.desc', 'Choose the first page shown when TeslaSync opens.'],
  ['search.entries.workspace.vehicle.desc', 'Choose the vehicle used for the global scope on a fresh app load.'],
  ['search.entries.workspace.range.desc', 'Choose the default time range used by global analysis controls.'],
  ['search.entries.workspace.discovery.title', 'Help and release highlights'],
  ['search.entries.workspace.discovery.desc', 'Control contextual explanations and product-change highlights.'],
  ['search.entries.security.totpEnroll.desc', 'Set up TOTP from your authenticator app to protect destructive admin actions.'],
  ['search.entries.security.totpBackupCodes.desc', 'Regenerate or download the backup codes used when you lose access to your authenticator.'],
  ['search.entries.security.totpDisable.desc', 'Remove the TOTP credential and revoke all backup codes for the current subject.'],
  ['search.entries.security.sessionsList.desc', 'See which browsers and devices are currently signed in to TeslaSync and revoke individual sessions.'],
  ['search.entries.security.sessionsRevokeAll.desc', 'Revoke every TeslaSync session except the current browser. Useful after a lost laptop or shared computer.'],
  ['search.entries.privacy.recentPagesClear.title', 'Clear recently viewed pages'],
  ['search.entries.privacy.recentPagesClear.desc', 'Wipe the local list of pages used by the status bar and the Recent section in the command palette.'],
  ['search.entries.privacy.consentManage.desc', 'Re-grant, withdraw, or reset the cookie / analytics consent banner state for this browser.'],
  ['search.entries.webhooks.list.desc', 'Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver.'],
  ['search.entries.webhooks.signing.desc', 'Sign outbound webhooks with a shared secret so receivers can verify authenticity via the X-TeslaSync-Signature header.'],
  ['search.entries.webhooks.test.desc', 'Fire a test event at a configured webhook to verify your receiver and signature pipeline.'],
  ['search.entries.reset.section.desc', 'Wipe one section at a time — alert rules, geofences, channels, automations, dashboard layouts, quiet hours, or general/appearance preferences.'],
  ['search.entries.reset.all.desc', 'Danger zone — wipe every user-discoverable preference, alert rule, channel, geofence, automation, and dashboard layout in one transaction. Requires typing RESET to confirm.'],
  ['search.entries.helix.integration.title', 'Helix (AI integration)'],
  ['search.entries.helix.integration.desc', 'Optional AI integration — provider, API key, cost cap, and per-feature opt-in toggles. Off by default.'],
  ['activity.myActivity.trend.aria', '{{total}} actions across {{days}} days'],
  ['help.commandReliability.overall', 'Three successes out of three is not the same evidence as ninety-seven out of a hundred, even though both read as a high percentage. The Wilson score interval accounts for how much evidence there actually is, so a command is only graded reliable once its pessimistic lower bound clears the bar — not merely its lucky average.'],
  ['activity.myActivity.brief.range', 'Loaded activity for {{start}} – {{end}}; at most {{limit}} actions.'],
  ['telemetry.sparkline.trend', '{{signal}} trend, {{count}} samples in the last hour'],
  ['physicsLedger.charge.empty', 'No charge interval in this window.'],
  ['physicsLedger.park.empty', 'No park interval in this window.'],
  ['a11y.summary.route.fromTo', 'Route map from {{start}} to {{end}}'],
  ['a11y.summary.route.distance', 'Distance {{distance}}'],
  ['a11y.summary.route.duration', 'Duration {{duration}}'],
  ['a11y.summary.gauge.value', '{{label}}: {{value}}'],
  ['a11y.summary.gauge.range', 'Scale {{min}} to {{max}}'],
  ['a11y.summary.state.current', '{{label}}: {{state}}'],
  ['a11y.summary.timeline.empty', '{{label}}: no entries'],
  ['a11y.summary.timeline.count', '{{label}}: {{count}} entries'],
  ['a11y.summary.timeline.span', 'From {{start}} to {{end}}'],
  ['a11y.status.loaded', '{{label}} loaded'],
  ['a11y.status.loadedCount', '{{label}} loaded, {{count}} items'],
  ['a11y.status.empty', 'No {{label}} to show'],
  ['a11y.status.refreshError', 'Could not refresh {{label}}'],
  ['a11y.status.saveError', 'Could not save {{label}}'],
  ['a11y.status.bulkPartial', '{{action}}: {{succeeded}} succeeded, {{failed}} failed'],
  ['a11y.status.bulkDone', '{{action}}: {{succeeded}} items'],
  ['a11y.status.selectionCount', '{{selectedCount}} of {{totalCount}} rows selected'],
  ['a11y.status.streamConnected', '{{scope}} connected'],
  ['a11y.status.streamReconnecting', '{{scope}} reconnecting'],
  ['a11y.status.streamDisconnected', '{{scope}} disconnected'],
  ['a11y.status.streamUpdated', '{{scope}} updated'],
] as const

const remaining = ['error.request.title', 'error.unavailable.title', 'error.unsupported.title']
const generated = import.meta.glob<{ default: Json }>('./en/locale-*.json', { eager: true })
const english = createInstance()

function nested(resource: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) =>
    value && typeof value === 'object' ? (value as Json)[segment] : undefined, resource)
}

function leaves(resource: Json, prefix = ''): [string, unknown][] {
  return Object.entries(resource).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' && !Array.isArray(value)
      ? leaves(value as Json, path)
      : [[path, value] as [string, unknown]]
  })
}

beforeAll(async () => {
  await english.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: catalog } },
    interpolation: { escapeValue: false },
  })
})

describe('exact81 feature-owned consistent producer defaults', () => {
  it.each(additions)('resolves %s as an exact canonical string, never an object or fallback', (key, value) => {
    expect(nested(catalog, key)).toBe(value)
    expect(english.exists(key)).toBe(true)
    const result = english.t(key, { skipInterpolation: true, returnObjects: true })
    expect(typeof result).toBe('string')
    expect(result).toBe(value)
    const resources = [shell, ...Object.values(generated).map(module => module.default)]
    expect(resources.some(resource => nested(resource, key) === value)).toBe(true)
  })

  it.each(additions)('interpolates all producer placeholders for %s using installed i18next', (key, value) => {
    const options: Record<string, string | number> = {}
    for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
      options[match[1]] = match[1] === 'count' ? 2 : `<${match[1]}>`
    }
    const expected = value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))
    expect(english.t(key, { ...options, returnObjects: true })).toBe(expected)
  })

  it.each([
    ['admin.diskForecast.tableCount', '{{count}} hypertables'],
    ['notifications.channels.providers.configured', '{{count}} configured'],
    ['telemetry.sparkline.trend', 'Speed trend, {{count}} samples in the last hour'],
    ['a11y.summary.timeline.count', 'Drives: {{count}} entries'],
    ['a11y.status.loadedCount', 'Drives loaded, {{count}} items'],
  ])('retains the source count default for %s at zero, one, two and many', (key, expected) => {
    for (const count of [0, 1, 2, 99]) {
      expect(english.t(key, { count, label: 'Drives', signal: 'Speed', returnObjects: true }))
        .toBe(expected.replace('{{count}}', String(count)))
    }
  })

  it('preserves the frozen fingerprint of all old leaves, including accepted18/PWA13/Settings', () => {
    expect(additions).toHaveLength(81)
    const keys = new Set<string>(additions.map(([key]) => key))
    const oldEntries = leaves(catalog).filter(([key]) => !keys.has(key))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    expect(oldEntries).toHaveLength(28176)
    expect(createHash('sha256').update(JSON.stringify(oldEntries)).digest('hex'))
      .toBe('e04f0f9479fe65e8a0346bc7dd53d53f662cc66850c18440ceae702a43698966')
    expect(leaves(catalog)).toHaveLength(28257)
    expect(english.t('settings.title')).toBe('Settings')
    expect(catalog.pwa).toMatchObject(shell.pwa)
    expect(shell.pwa.offline).toEqual(catalog.pwa.offline)
    expect(shell.pwa.update).toEqual(catalog.pwa.update)
    expect(shell.pwa.cache).toEqual(catalog.pwa.cache)
  })

  it('leaves exactly the three genuine error-title misses unsupplemented in every artifact', () => {
    expect(baseline).toEqual(remaining)
    expect(runtimeManifest.missing).toEqual(remaining)
    expect(usageManifest.knownMissingKeys).toEqual(remaining)
    for (const key of remaining) {
      expect(english.exists(key)).toBe(false)
      for (const resource of [catalog, shell, ...Object.values(generated).map(module => module.default)]) {
        expect(nested(resource, key)).toBeUndefined()
      }
    }
  })
})
