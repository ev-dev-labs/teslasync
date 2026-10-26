import { expect, test } from '@playwright/test'
import { measureTz } from './timezoneSweep'

const timestamp = '2026-10-22T07:00:00.000Z'
const clippedStyles = `
  .accessible-chart {
    position: absolute; width: 1px; height: 1px; padding: 0;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap;
  }
  @media (forced-colors: active) {
    .accessible-chart {
      position: static; width: auto; height: auto; overflow: visible; clip: auto;
    }
  }
`

test('timezone sweep still reports every visible timestamp and zone category', async ({ page }) => {
  await page.setContent(`
    <p>${timestamp}</p><p>UTC</p><p>America/Los_Angeles</p><p>GMT-7</p>
  `)
  const result = await measureTz(page)
  expect(result.iso.map(hit => hit.text)).toEqual([timestamp])
  expect(result.zones.map(hit => hit.text)).toEqual(['UTC', 'America/Los_Angeles', 'GMT-7'])
})

test('timezone sweep distinguishes clipped accessible chart data from visible content', async ({ page }) => {
  await page.setContent(`
    <style>${clippedStyles}</style>
    <figure><figcaption class="accessible-chart"><div><p>${timestamp} UTC</p></div></figcaption></figure>
    <p>GMT-7</p>
  `)
  const result = await measureTz(page)
  expect(result.iso).toEqual([])
  expect(result.zones.map(hit => hit.text)).toEqual(['GMT-7'])
  expect(result.dupes).toEqual([])
})

test('timezone sweep checks chart fallback text when forced colors makes it visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.setContent(`
    <style>${clippedStyles}</style>
    <figure><figcaption class="accessible-chart"><p>${timestamp} UTC</p></figcaption></figure>
  `)
  const result = await measureTz(page)
  expect(result.iso.map(hit => hit.text)).toEqual([timestamp])
  expect(result.zones.map(hit => hit.text)).toEqual(['UTC'])
})

test('timezone sweep does not treat an ineffective static clip as hidden', async ({ page }) => {
  await page.setContent('<p style="clip: rect(0, 0, 0, 0)">UTC</p>')
  expect((await measureTz(page)).zones.map(hit => hit.text)).toEqual(['UTC'])
})

test('timezone sweep excludes invisible ancestors without losing visible duplicate detection', async ({ page }) => {
  await page.setContent(`
    <div style="visibility: hidden"><p>America/Los_Angeles</p></div>
    <div style="display: none"><p>GMT-7</p></div>
    <p>${timestamp}</p><p>Oct 22, 2026, 07:00 AM</p>
  `)
  const result = await measureTz(page)
  expect(result.zones).toEqual([])
  expect(result.iso.map(hit => hit.text)).toEqual([timestamp])
  expect(result.dupes).toEqual([`${timestamp}  <>  Oct 22, 2026, 07:00 AM`])
})
