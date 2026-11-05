import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect } from 'vitest'
import ts from 'typescript'
import checkpoints from './verified-combined-checkpoints.json'
import notificationCopyChanges from './verified-notification-copy.json'

// These exact files passed the key/default/interpolation/count audit before generation.
// Keep all historical assertions for producers outside this explicit checkpoint set.
export function assertCombinedCheckpoint(group: 'canonical' | 'owner', file: string): boolean {
  if (!checkpoints[group].includes(file)) return false
  const checkpoint = checkpoints.sources.find(entry => entry.file === file)
  if (!checkpoint) throw new Error('Missing verified combined producer: ' + file)
  const source = readFileSync(resolve(process.cwd(), '..', file), 'utf8')
  expect(createHash('sha256').update(source).digest('hex'), file).toBe(checkpoint.sha256)
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let calls = 0
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 't')
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'))) calls++
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(calls, file).toBe(checkpoint.calls)
  return true
}

export const currentOwnerCheckpointFiles = checkpoints.owner

const dashboardPolishAdditions = [
  ['dashboard.chargingEstimatedLabel', '{{label}} (estimated)'],
  ['dashboard.chargerAc', 'AC'],
  ['charging.stats.energySplitUnknownAria', 'Energy split: {{ac}}% AC, {{dc}}% DC, {{unknown}}% unknown'],
  ['charging.chargerTypes.ac', 'AC'],
  ['charging.sessionCharging', 'Charging'],
  ['charging.sessionPower', 'Power'],
  ['charging.currentPower', 'Current power'],
  ['charging.currentPowerValue', '{{value}} kW now'],
  ['charging.estimatedCostValue', '{{cost}} (estimated)'],
  ['charging.includesEstimatedCosts', 'Includes estimated charging costs; Tesla invoices and manual amounts take precedence.'],
  ['telemetry.selfDrivingSoftwareVersion', 'FSD software version'],
  ['telemetry.semiTrailerLatched', 'Semi trailer latched'],
  ['dashboard.chargeStatus.chargeLimit', 'Charge limit'],
  ['dashboard.chargeStatus.lastReported', 'Last reported'],
  ['dashboard.widgetSettings.refreshHelp', 'Adds periodic refreshes. Live updates and existing polling may arrive more often; dashboard settings apply when Default is selected.'],
  ['dashboard.widgetSettings.rangeDefault', 'Widget default'],
  ['dashboard.widgetSettings.rangeHistoryHelp', 'Filters historical data by a rolling range. Recent lists and session charts also limit the number of records shown.'],
  ['dashboard.widgetSettings.rangeFixedHelp', 'This widget uses live data, a fixed period, or the workspace range; changing this selection does not change its data.'],
  ['dashSettings.refreshHelp', 'Adds periodic refreshes unless a widget has its own interval. Live updates and existing polling may arrive more often.'],
  ['widget.analyticsSummary.distanceRange', 'Distance (selected range)'],
  ['widget.analyticsSummary.distanceViewRange', 'Distance (view range)'],
  ['widget.chargeCost.selectedRangeCost', 'Cost for selected range'],
  ['widget.chargeCost.selectedRangeEstimate', 'Estimate for selected range'],
  ['widget.driveEfficiencyChart.selectedRangeAverage', 'Selected-range average'],
  ['widget.fleetStatsBar.distanceRange', 'Distance (selected range)'],
  ['widget.fleetStatsBar.energyRange', 'Energy (selected range)'],
  ['widget.fleetStatsBar.distanceViewRange', 'Distance (view range)'],
  ['widget.fleetStatsBar.energyViewRange', 'Energy (view range)'],
  ['widget.recentDrivesSummary', '{{count}} recent drives \u00b7 {{total}}'],
  ['dbHealth.estimatedRows', 'Estimated rows'],
  ['dbHealth.estimatedTotalRows', 'Estimated total rows'],
  ['dbHealth.rowEstimatesNote', 'Row counts are estimates from database statistics, including hypertable chunks. They may lag recent writes; size values are measured bytes.'],
] as const

/** Assert exact new copy before projecting it out of unchanged historical fingerprints. */
export function catalogBeforeDashboardPolish<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog)
  // Pin every reviewed notification addition/change before reconstructing the
  // predecessor. The historical catalog counts and hashes remain unchanged.
  for (const change of notificationCopyChanges) {
    let parent: Record<string, unknown> = previous
    for (const part of change.path.slice(0, -1)) parent = parent[part] as Record<string, unknown>
    const leaf = change.path[change.path.length - 1]
    expect(parent[leaf], change.path.join('.')).toEqual(change.current)
    if ('previous' in change) parent[leaf] = change.previous
    else delete parent[leaf]
  }
  for (const [key, expected] of dashboardPolishAdditions) {
    const parts = key.split('.')
    let parent: Record<string, unknown> = previous
    for (const part of parts.slice(0, -1)) {
      const child = parent[part]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        throw new Error('Missing reviewed catalog path: ' + key)
      }
      parent = child as Record<string, unknown>
    }
    const leaf = parts[parts.length - 1]
    expect(parent[leaf], key).toBe(expected)
    delete parent[leaf]
  }
  return previous
}
