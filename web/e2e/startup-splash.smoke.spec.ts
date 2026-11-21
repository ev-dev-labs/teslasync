import { expect, test } from '@playwright/test'
import { installApiMocks } from './mockApi'

const scenarios = [
  { mode: 'dark', system: 'light', motion: 'no-preference', width: 1062, background: 'rgb(11, 13, 18)' },
  { mode: 'light', system: 'dark', motion: 'reduce', width: 320, background: 'rgb(248, 250, 252)' },
  { mode: 'auto', system: 'light', motion: 'no-preference', width: 390, background: 'rgb(248, 250, 252)' },
] as const

for (const { mode, system, motion, width, background } of scenarios) {
  test(`startup bolt paints before React in ${mode} mode (${motion})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 635 })
    await page.emulateMedia({ colorScheme: system, reducedMotion: motion })
    await page.addInitScript(savedMode => localStorage.setItem('teslasync-mode', savedMode), mode)
    await installApiMocks(page)

    let unblock = () => {}
    const loading = new Promise<void>(resolve => { unblock = resolve })
    await page.route(/\/(?:src\/main\.tsx|assets\/index-[^/]+\.js)(?:\?.*)?$/, async route => {
      await loading
      await route.continue()
    })

    const splash = page.getByRole('progressbar', { name: 'TeslaSync' })
    try {
      await page.goto('/fleet-api', { waitUntil: 'commit' })
      await expect(page.locator('#root')).toBeEmpty()
      await expect(splash).toBeVisible()
      await expect(splash).toHaveAccessibleDescription('Fleet Intelligence Platform')
      await expect(splash).not.toHaveAttribute('aria-valuenow')
      await expect(splash).toHaveCSS('background-color', background)
      const path = splash.locator('svg path')
      if (motion === 'reduce') {
        await expect(path).toHaveCSS('animation-name', 'none')
        await expect(path).toHaveCSS('fill-opacity', '1')
        await expect(path).toHaveCSS('stroke-dasharray', 'none')
        await expect(splash).toHaveCSS('transition-duration', '0s')
      } else {
        const phases = await path.evaluate(element => {
          const [animation] = element.getAnimations()
          if (!animation) return []
          animation.pause()
          return [600, 1200].map(time => {
            animation.currentTime = time
            const { fillOpacity, strokeDashoffset } = getComputedStyle(element)
            return { fillOpacity, stroke: parseFloat(strokeDashoffset) }
          })
        })
        expect(phases).toEqual([{ fillOpacity: '0', stroke: 0 }, { fillOpacity: '1', stroke: 0 }])
      }
    } finally {
      unblock()
    }

    await expect(page.locator('#splash')).toHaveCount(0)
    await expect(page.locator('#root')).not.toBeEmpty()
  })
}
