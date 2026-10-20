import { expect, test, type Page } from '@playwright/test'
import type { ThemeId } from '../src/components/ui/ThemeProvider'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

// Each preset has exactly one source hex; the app must apply it unchanged.
// `custom` resolves to the mocked settings' custom_primary.
const SELECTIONS: ReadonlyArray<{ id: ThemeId; hex: string }> = [
  { id: 'neon-cyan', hex: '#3b82f6' },
  { id: 'tesla-red', hex: '#e31937' },
  { id: 'matrix-green', hex: '#00ff41' },
  { id: 'royal-purple', hex: '#a855f7' },
  { id: 'solar-amber', hex: '#f59e0b' },
  { id: 'custom', hex: '#00b4d8' },
]

function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

async function appliedAccent(page: Page) {
  return page.evaluate(() => {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim().toLowerCase()
    // The production primary variant paints `bg-[var(--theme-primary)]`.
    const button = Array.from(document.querySelectorAll<HTMLElement>('button, a'))
      .find((element) => element.className.includes('bg-[var(--theme-primary)]') && element.offsetParent !== null)
    return { token, background: button ? getComputedStyle(button).backgroundColor : null }
  })
}

for (const mode of ['dark', 'light'] as const) {
  for (const { id, hex } of SELECTIONS) {
    test(`applies the exact ${id} accent ${hex} in ${mode} mode`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await seedBrowserState(page, mode, '/api-keys')
      await page.addInitScript((themeId) => localStorage.setItem('teslasync-theme', themeId), id)
      const api = await installApiMocks(page, 'populated', mode, 'comfortable', id)
      // "Create key" is a static primary action on this route.
      await page.goto('/api-keys', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)

      await expect.poll(async () => (await appliedAccent(page)).token).toBe(hex)
      await expect.poll(async () => (await appliedAccent(page)).background, { message: 'a visible primary button' }).not.toBeNull()
      expect((await appliedAccent(page)).background).toBe(rgb(hex))
    })
  }
}
