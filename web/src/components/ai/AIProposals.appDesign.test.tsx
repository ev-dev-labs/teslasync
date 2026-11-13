import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appSettingsPayload } from '@/test/fixtures/appSettings'
import { makeReadableStream, sseFrame } from '@/test/fixtures/aiPayloads'
import { useSettings } from '@/hooks/useSettings'
import type { AutomationFullInput } from '@/api/hooks/useAutomations'
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../ui/app-designs/designs'
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types'
import { AIAlertMessageTemplateSuggestion } from './AIAlertMessageTemplateSuggestion'
import { AIAutoNameUnnamedLocations } from './AIAutoNameUnnamedLocations'
import { AIGeofenceAwareAutomationSuggestions } from './AIGeofenceAwareAutomationSuggestions'
import { AIInboxAutoCategorization } from './AIInboxAutoCategorization'
import { AIQuietHoursSuggestion } from './AIQuietHoursSuggestion'
import { AISuggestNewGeofences } from './AISuggestNewGeofences'

vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))

const features = [
  'alert-message-template-suggestion', 'auto-name-unnamed-locations',
  'geofence-aware-automation-suggestions', 'inbox-auto-categorization',
  'quiet-hours-suggestion', 'suggest-new-geofences',
]
const longCategory = 'Retained category with a complete long translated label '.repeat(3).trim()
const automation: AutomationFullInput = {
  name: 'Proposed arrival notification',
  description: 'Review the complete proposed graph before saving',
  vehicle_id: 7,
  enabled: false,
  triggers: [{ kind: 'trigger_geofence', place_id: 1, event: 'enter' }],
  conditions: [],
  actions: [{ kind: 'action_wait', duration_s: 30 }],
}
const quietHours = {
  start_local: '23:00', end_local: '07:30', timezone: 'America/Los_Angeles',
  weekdays: 127, bypass_severities: ['critical'], status: 'insufficient_history',
  existing_windows_count: 2,
}
const geofence = {
  location_id: 501, vehicle_id: 7, proposed_name: 'Proposed stop', radius_m: 150.4,
  centroid_lat: 47.6062, centroid_lon: -122.3321,
}
const replies: Record<string, { tool: string; data: unknown }> = {
  '/api/v1/ai/alerts/message-template/draft': {
    tool: 'validate_alert_message_template',
    data: { template: '{{VehicleName}}: brake {{Value}}', used_placeholders: ['VehicleName', 'Value'], status: 'ok' },
  },
  '/api/v1/ai/locations/501/name/draft': {
    tool: 'draft_location_name',
    data: { location_id: 501, proposed_name: 'Proposed stop', status: 'ok', reason: 'Retained visit-pattern explanation' },
  },
  '/api/v1/ai/geofences/automations/draft': {
    tool: 'draft_automation_graph', data: { draft: automation, status: 'ok' },
  },
  '/api/v1/ai/alerts/inbox/categorize': {
    tool: 'draft_alert_categories',
    data: { status: 'ok', categories: [
      { category: longCategory, count: 0, rule_ids: [7, 3] },
      { category: 'Other category', count: 2147483647, rule_ids: [3, 5] },
    ] },
  },
  '/api/v1/ai/settings/quiet-hours/draft': { tool: 'draft_quiet_hours_window', data: quietHours },
  '/api/v1/ai/geofences/draft': { tool: 'draft_geofence', data: { draft: geofence, status: 'ok' } },
}
const rules: Rule[] = []
postcss.parse(readFileSync(resolve(
  process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css',
), 'utf8')).walkRules(rule => { rules.push(rule) })

function matching(node: Element, contract: string, mode = '') {
  return rules.flatMap(rule => rule.selectors.filter(selector =>
    selector.includes(contract) && selector.includes(mode)
    && [...node.ownerDocument.querySelectorAll(selector)].includes(node),
  ))
}

function callbacks() {
  return {
    template: vi.fn(), name: vi.fn(), automation: vi.fn(),
    categories: vi.fn(), quietHours: vi.fn(), geofence: vi.fn(),
  }
}

function subjects(apply: ReturnType<typeof callbacks>) {
  return <>
    <AIAlertMessageTemplateSuggestion
      draft={{ kind: 'signal', signal_name: 'BrakePedal', op: '=' }}
      onApplyTemplate={apply.template}
    />
    <AIAutoNameUnnamedLocations locationId={501} currentName="47.6062,-122.3321" onApplyName={apply.name} />
    <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={apply.automation} />
    <AIInboxAutoCategorization onApplyCategories={apply.categories} />
    <AIQuietHoursSuggestion onApplyDraft={apply.quietHours} />
    <AISuggestNewGeofences locationId={501} currentName="47.6062,-122.3321" onApplyDraft={apply.geofence} />
  </>
}

async function suggestAll() {
  fireEvent.change(screen.getByTestId('ai-feature-geofence-aware-automation-suggestions-prompt'), {
    target: { value: 'Propose an arrival notification for review' },
  })
  for (const feature of features) {
    const verb = feature === 'inbox-auto-categorization' ? 'categorize' : 'suggest'
    await act(async () => {
      fireEvent.click(screen.getByTestId(`ai-feature-${feature}-${verb}`))
    })
  }
  await waitFor(() => {
    for (const feature of features) {
      expect(screen.getByTestId(`ai-feature-${feature}-apply`)).toBeEnabled()
    }
  })
}

function expectProposalConsumer(proposal: Element, pack: PackId) {
  expect(proposal).toHaveAttribute('data-app-part', 'feedback')
  expect(proposal).toHaveAttribute('data-app-tone', 'neutral')
  const mode = APPLICATION_DESIGNS[pack].feedback
  const selected = matching(proposal, '[data-app-feedback-kind="insight"]', `[data-app-feedback="${mode}"]`)
  expect(selected.length).toBeGreaterThan(0)
  expect(selected.every(selector => selector.includes(`[data-app-design-owner~="feedback-${mode}"]`))).toBe(true)
  for (const slot of proposal.querySelectorAll('[data-app-part~="feedback-title"], [data-app-part~="feedback-message"], [data-app-part~="feedback-detail"]')) {
    const part = slot.getAttribute('data-app-part')!
    expect(matching(slot, `[data-app-part~="${part}"]`).length).toBeGreaterThan(0)
  }
  expect(proposal.querySelector('[data-app-part~="feedback-title"]')).not.toBeNull()
  expect(proposal.querySelector('[role="progressbar"], [data-metric-track]')).toBeNull()
}

beforeEach(() => {
  vi.mocked(useSettings, { partial: true }).mockReturnValue(appSettingsPayload({
    ai_mode: 'cloud', ai_features: Object.fromEntries(features.map(feature => [feature, true])),
  }))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const reply = replies[String(input)]
    if (!reply) throw new Error(`Unexpected fixture request: ${String(input)}`)
    return new Response(makeReadableStream([
      sseFrame('tool_result', { id: reply.tool, name: reply.tool, ok: true, data: reply.data })
      + sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('actual typed proposal renderers and existing design consumers (source-only)', () => {
  it.each(PACK_IDS)('%s composes all six native proposal cards and the real category/count list', async pack => {
    const apply = callbacks()
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>{subjects(apply)}</div>)
    const host = view.container.firstElementChild!
    const release = observeAppDesignScopes(host)
    try {
      expect(host.querySelectorAll('[data-app-feedback-kind="insight"]')).toHaveLength(0)
      await suggestAll()
      const proposals = host.querySelectorAll('[data-app-feedback-kind="insight"]')
      expect(proposals).toHaveLength(6)
      await waitFor(() => expect(proposals[5]).toHaveAttribute('data-app-design-owner'))
      for (const proposal of proposals) expectProposalConsumer(proposal, pack)
      expect(proposals[0]).toHaveAttribute('role', 'status')
      expect(proposals[0]).toHaveTextContent('{{VehicleName}}: brake {{Value}}')
      expect(proposals[0]).toHaveTextContent('VehicleName, Value')
      expect(proposals[1]).toHaveAttribute('aria-live', 'polite')
      expect(proposals[2]).toHaveTextContent('Triggers: 1 · Conditions: 0 · Actions: 1')
      expect(proposals[4]).toHaveTextContent('23:00')
      expect(proposals[4]).toHaveTextContent('America/Los_Angeles')
      expect(proposals[4]).toHaveTextContent(/insufficient notification history/i)
      expect(proposals[4]).toHaveTextContent(/already have 2 quiet-hours window/i)
      expect(proposals[5]).toHaveAttribute('role', 'group')
      expect(proposals[5]).toHaveAccessibleName('Proposed geofence')
      expect(proposals[5]).toHaveTextContent('150 m')
      const list = proposals[3].querySelector('[data-app-list="definitions"]')!
      expect(list.tagName).toBe('UL')
      expect(list.children).toHaveLength(2)
      expect([...list.children].map(row => row.querySelector('[data-app-part="metric-label"]')?.textContent))
        .toEqual([longCategory, 'Other category'])
      expect([...list.children].map(row => row.querySelector('[data-app-part="metric-value"]')?.textContent))
        .toEqual(['0', '2147483647'])
      for (const row of list.children) {
        expect(row.tagName).toBe('LI')
        expect(row).toHaveAttribute('data-app-part', 'list-row')
        const reading = row.querySelector('[data-app-part="metric-reading"]')!
        const mode = APPLICATION_DESIGNS[pack].data
        expect(matching(reading, '[data-app-list="definitions"]', `[data-app-data="${mode}"]`).length).toBeGreaterThan(0)
        expect(row.querySelector('[aria-hidden="true"]')).toHaveTextContent('·')
      }
      for (const callback of Object.values(apply)) expect(callback).not.toHaveBeenCalled()
      for (const feature of features) fireEvent.click(screen.getByTestId(`ai-feature-${feature}-apply`))
      expect(apply.template).toHaveBeenCalledExactlyOnceWith('{{VehicleName}}: brake {{Value}}')
      expect(apply.name).toHaveBeenCalledExactlyOnceWith('Proposed stop')
      expect(apply.automation).toHaveBeenCalledExactlyOnceWith(automation)
      expect(apply.categories).toHaveBeenCalledExactlyOnceWith([3, 5, 7])
      expect(apply.quietHours).toHaveBeenCalledExactlyOnceWith({
        enabled: true, start_local: '23:00', end_local: '07:30', timezone: 'America/Los_Angeles',
        weekdays: 127, bypass_severities: ['critical'],
      })
      expect(apply.geofence).toHaveBeenCalledExactlyOnceWith({
        name: 'Proposed stop', latitude: 47.6062, longitude: -122.3321, radius: 150.4,
      })
      expect(fetch).toHaveBeenCalledTimes(6)
      expect(vi.mocked(fetch).mock.calls.map(call => String(call[0]))).toEqual(Object.keys(replies))
    } finally {
      release()
    }
  })

  it.each(['neutral', 'incomplete', 'nested'] as const)('%s uses only the nearest complete profile, retaining original cards outside opt-in', async boundary => {
    const apply = callbacks()
    const inner = boundary === 'nested' ? getAppDesignAttributes('blueprint')
      : boundary === 'incomplete' ? { 'data-app-design-pack': 'v1' } : {}
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes('warm')}>
        <div data-testid="local-host" data-app-design-preview="" {...inner}>{subjects(apply)}</div>
      </div>,
    )
    const release = observeAppDesignScopes(view.container.firstElementChild!)
    try {
      await suggestAll()
      const proposals = screen.getByTestId('local-host').querySelectorAll('[data-app-feedback-kind="insight"]')
      expect(proposals).toHaveLength(6)
      for (const proposal of proposals) {
        if (boundary === 'nested') {
          expectProposalConsumer(proposal, 'blueprint')
          expect(proposal.getAttribute('data-app-design-owner')).toContain('pack-blueprint')
        } else {
          expect(proposal).not.toHaveAttribute('data-app-design-owner')
          expect(matching(proposal, '[data-app-feedback-kind="insight"]')).toHaveLength(0)
          expect(proposal).toHaveClass('border', 'p-3')
        }
      }
      expect(proposals[1]).toHaveClass('border-theme-accent/30', 'bg-theme-accent/5')
      expect(proposals[3].querySelector('[data-app-part="list-row"]')).toHaveClass('rounded-full')
      for (const callback of Object.values(apply)) expect(callback).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })

  it('creates no proposal, requests or replacement actions with AI disabled', () => {
    vi.mocked(useSettings, { partial: true }).mockReturnValue(appSettingsPayload({
      ai_mode: 'off', ai_features: Object.fromEntries(features.map(feature => [feature, true])),
    }))
    const apply = callbacks()
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes('v1')}>{subjects(apply)}</div>)
    expect(view.container.firstElementChild).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
    for (const callback of Object.values(apply)) expect(callback).not.toHaveBeenCalled()
  })
})
