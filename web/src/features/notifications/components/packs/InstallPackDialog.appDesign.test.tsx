import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import postcss, { type Rule } from 'postcss'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertPack } from '@/api/hooks/useAlertPacks'
import { NavigationGuardProvider } from '@/components/feedback'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs'
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import InstallPackDialog from './InstallPackDialog'

const state = vi.hoisted(() => ({ desktop: true, install: vi.fn() }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => state.desktop }))
vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => false }))
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [], refetch: vi.fn() }),
}))
vi.mock('@/api/hooks/useNotifications', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useNotifications')>(),
  useNotificationChannels: () => ({ data: [], refetch: vi.fn() }),
}))
vi.mock('@/api/hooks/useAlertPacks', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useAlertPacks')>(),
  useInstallAlertPack: () => ({ mutate: state.install, isPending: false, isSuccess: false }),
}))
const pack: AlertPack = {
  id: 'source-test', version: 1, name: 'Source pack', description: 'Complete source description',
  rules: Array.from({ length: 11 }, (_, i) => ({
    id: `rule-${i}`, unit: '%',
    rule: {
      id: i, name: `Complete original rule ${i}`, signal_name: 'BatteryLevel', op: '<',
      value_num: i, enabled: false, severity: 'warn', cooldown_min: 60,
      trigger_mode: 'once', msg_template: 'Complete original notification {{Value}}',
      include_title: true, all_vehicles: true, vehicle_ids: [], created_at: '', updated_at: '',
    },
  })),
}
const identities = new Map(PACK_IDS.map(id => {
  const rules: Rule[] = []
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs', `${id}.css`), 'utf8'))
    .walkRules(rule => { rules.push(rule) })
  return [id, rules]
}))
function consumes(node: Element, packId: typeof PACK_IDS[number], part: string) {
  return identities.get(packId)!.some(rule => rule.selectors.some(selector =>
    selector.includes(`[data-app-part~="${part}"]`) && node.matches(selector)))
}
beforeEach(() => {
  state.desktop = true
  state.install.mockReset()
})

describe('install defaults, mobile preview and filter-recovery ownership (source-only)', () => {
  it.each(PACK_IDS)('%s composes the actual opened desktop defaults and mobile records without changing selections or installation', async packId => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const profile = getAppDesignAttributes(packId)
    for (const [name, value] of Object.entries(profile)) document.documentElement.setAttribute(name, value)
    const release = observeAppDesignScopes(document.documentElement)
    const tree = () => <QueryClientProvider client={client}><MemoryRouter><NavigationGuardProvider>
      <InstallPackDialog pack={pack} onClose={vi.fn()} />
    </NavigationGuardProvider></MemoryRouter></QueryClientProvider>
    const view = render(tree())
    try {
      await act(async () => {})
      const defaults = screen.getByRole('region', { name: 'Pack defaults' })
      expect(consumes(defaults, packId, 'panel')).toBe(true)
      expect(screen.getByRole('table', { name: 'Choose rules' })).toBeInTheDocument()
      const defaultCooldown = screen.getByRole('spinbutton', { name: 'Default cooldown (minutes)' }) as HTMLInputElement
      expect(defaults).toContainElement(defaultCooldown)
      const originalCooldown = defaultCooldown.valueAsNumber
      const first = screen.getByRole('checkbox', { name: 'Complete original rule 0' })
      fireEvent.click(first)
      expect(first).not.toBeChecked()
      expect(screen.getByText('10 of 11 rules selected')).toBeInTheDocument()
      const search = screen.getByPlaceholderText('Search pack rules...')
      fireEvent.change(search, { target: { value: 'absent-source-rule' } })
      await act(async () => {})
      const empty = (await screen.findByText('No matching rules. Clear the search to see the full pack.'))
        .closest('[data-app-feedback-kind="empty"]')!
      expect(matchesAppDesignCss(empty, '[data-app-feedback-kind="empty"]').some(match =>
        match.selector.includes(`[data-app-feedback="${APPLICATION_DESIGNS[packId].feedback}"]`))).toBe(true)
      expect(empty.querySelector('[data-app-part~="feedback-message"]')).not.toBeEmptyDOMElement()
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(screen.getByRole('checkbox', { name: 'Complete original rule 0' })).not.toBeChecked()
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      expect(screen.getByRole('checkbox', { name: 'Complete original rule 10' })).toBeChecked()
      fireEvent.click(screen.getByRole('button', { name: 'Previous' }))

      state.desktop = false
      view.rerender(tree())
      await act(async () => {})
      expect(screen.queryByRole('table', { name: 'Choose rules' })).not.toBeInTheDocument()
      const previews = screen.getAllByRole('region', { name: /^Complete original rule/ })
      expect(previews).toHaveLength(10)
      for (const preview of previews) {
        expect(consumes(preview, packId, 'card')).toBe(true)
        expect(within(preview).getByRole('combobox', { name: 'Operator' })).toBeInTheDocument()
        expect(within(preview).getByRole('combobox', { name: 'Channels' })).toBeInTheDocument()
        expect(within(preview).getByRole('textbox', { name: 'Notification message' }))
          .toHaveValue('Complete original notification {{Value}}')
        expect(within(preview).getByRole('checkbox', { name: 'Include title in notifications' })).toBeChecked()
      }
      const mobileRule = previews[1]
      fireEvent.change(within(mobileRule).getByRole('spinbutton', { name: 'Minimum minutes between notifications' }), { target: { value: '2' } })
      expect(within(mobileRule).getByText('Customized')).toBeInTheDocument()
      fireEvent.click(within(mobileRule).getByRole('button', { name: 'Reset delivery to pack defaults' }))
      expect(within(mobileRule).getByRole('spinbutton', { name: 'Minimum minutes between notifications' })).toHaveValue(originalCooldown)
      fireEvent.click(screen.getByRole('button', { name: /Pack defaults/ }))
      expect(screen.getByRole('spinbutton', { name: 'Default cooldown (minutes)' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Complete original rule 0' })).not.toBeChecked()
      expect(state.install).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      release()
      for (const name of Object.keys(profile)) document.documentElement.removeAttribute(name)
      client.clear()
    }
  })
})
