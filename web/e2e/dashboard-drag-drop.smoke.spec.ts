import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

async function createCommuter(page) {
  await page.getByRole('button', { name: 'Switch dashboard layout' }).click()
  await page.getByRole('menuitem', { name: 'New from template…' }).click()
  await page.getByRole('button', { name: /Daily Commuter/ }).click()
  await page.getByRole('dialog', { name: 'Create a layout' })
    .getByRole('button', { name: 'Create layout' }).click()
  await expect(page.getByRole('button', { name: 'Switch dashboard layout' })).toContainText('Daily Commuter')
}

async function readLayouts(page): Promise<Record<string, LayoutItem[]>> {
  return page.evaluate(() => {
    const dashboards = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{
      id: string
      layouts: Record<string, LayoutItem[]>
    }>
    const active = localStorage.getItem('teslasync-active-dashboard') ?? ''
    return dashboards.find((d) => d.id === active)?.layouts ?? {}
  })
}

/** Pairwise overlap count — the hard grid invariant (must always be 0). */
function countOverlaps(items: LayoutItem[]): number {
  let overlaps = 0
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const A = items[a]
      const B = items[b]
      if (A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y) overlaps++
    }
  }
  return overlaps
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('drag persists on the active breakpoint without touching the others', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await createCommuter(page)
  await waitForHarnessReady(page, mockApi)

  const before = await readLayouts(page)
  await page.getByRole('button', { name: /customize/i }).click()

  // Drag the first widget exactly one column right (no vertical ambiguity).
  const handle = page.locator('.widget-drag-handle').first()
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + (384 * i) / 8, cy)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
  await expect.poll(async () => JSON.stringify(await readLayouts(page))).not.toBe(JSON.stringify(before))

  const after = await readLayouts(page)
  // 1440px viewport with sidebar renders the md breakpoint.
  const movedId = before.md.find((l) => l.x === 0 && l.y === 0)?.i
  expect(movedId).toBeDefined()
  expect(after.md.find((l) => l.i === movedId)?.x).toBe(1)
  // Untouched breakpoints are byte-identical (cross-breakpoint clobber guard).
  expect(after.lg).toEqual(before.lg)
  expect(after.sm).toEqual(before.sm)
  expect(after.xs).toEqual(before.xs)
  expect(countOverlaps(after.md)).toBe(0)

  // Opening a fresh document in the same context verifies persistence across
  // mounts without navigating the old page while its API mocks are active.
  const restoredPage = await page.context().newPage()
  await seedBrowserState(restoredPage, 'dark', '/', { preserveDashboardState: true })
  const restoredApi = await installApiMocks(restoredPage, 'populated')
  await restoredPage.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(restoredPage, restoredApi)
  const reloaded = await readLayouts(restoredPage)
  expect(reloaded).toEqual(after)
  await restoredPage.close()
})

test('auto arrange compacts every breakpoint without overlaps', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await createCommuter(page)
  await waitForHarnessReady(page, mockApi)
  await page.getByRole('button', { name: /customize/i }).click()
  await page.getByRole('button', { name: 'Auto Arrange' }).click()

  await expect.poll(async () => {
    const layouts = await readLayouts(page)
    return Object.values(layouts).every((items) => countOverlaps(items) === 0)
  }).toBe(true)

  // Compactness (exact): no item sits above a row it could rise into.
  // A vertically compacted layout pulls every item up until it rests on the
  // floor or another item — anything that could move to y-1 is a floater.
  const layouts = await readLayouts(page)
  for (const [bp, items] of Object.entries(layouts)) {
    for (const l of items) {
      if (l.y === 0) continue
      const lifted = { ...l, y: l.y - 1 }
      const blocked = items.some(
        (o) =>
          o.i !== l.i
          && lifted.x < o.x + o.w
          && lifted.x + lifted.w > o.x
          && lifted.y < o.y + o.h
          && lifted.y + lifted.h > o.y,
      )
      expect(blocked, `${bp}: ${l.i} floats at y${l.y}`).toBe(true)
    }
  }
})

test('docked picker drops onto the grid, rejects duplicates, and adds-and-arranges from the hint', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await createCommuter(page)
  await waitForHarnessReady(page, mockApi)
  await page.getByRole('button', { name: /customize/i }).click()

  await page.getByRole('button', { name: 'Add Widget' }).first().click()
  const dock = page.getByRole('complementary', { name: 'Add Widget' })
  await expect(dock).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Add Widget' })).toHaveCount(0)
  const grid = page.locator('.react-grid-layout')
  const box = await grid.boundingBox()
  expect(box).not.toBeNull()
  const dropBreakpoint = box!.width > 996 ? 'md' : 'sm'
  const source = dock.getByRole('button', { name: /Odometer/ })
  await source.dragTo(grid, {
    targetPosition: { x: box!.width * 0.75, y: Math.min(140, box!.height / 2) },
    steps: 12,
  })

  await expect.poll(async () => page.evaluate(() => {
    const dashboards = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{
      id: string
      widgets: Array<{ id: string; widgetId: string }>
    }>
    const active = localStorage.getItem('teslasync-active-dashboard') ?? ''
    return (dashboards.find((d) => d.id === active)?.widgets ?? [])
      .some((w) => w.widgetId === 'odometer-counter')
  })).toBe(true)

  await expect.poll(async () => countOverlaps((await readLayouts(page))[dropBreakpoint])).toBe(0)
  const layouts = await readLayouts(page)
  const addedId = await page.evaluate(() => {
    const dashboards = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{
      id: string
      widgets: Array<{ id: string; widgetId: string }>
    }>
    return dashboards.find((d) => d.id === localStorage.getItem('teslasync-active-dashboard'))
      ?.widgets.find((w) => w.widgetId === 'odometer-counter')?.id
  })
  expect(layouts[dropBreakpoint].find((item) => item.i === addedId)?.x).toBe(1)
  await expect(source).toBeDisabled()
  await expect(page.locator('.react-grid-item.dropping')).toHaveCount(0)

  const before = (await readLayouts(page))[dropBreakpoint].length
  await dock.getByRole('button', { name: /Vehicle Hero Card/ })
    .dragTo(page.getByTestId('dashboard-arrange-drop'))
  await expect.poll(async () => (await readLayouts(page))[dropBreakpoint].length).toBe(before + 1)
  expect(countOverlaps((await readLayouts(page))[dropBreakpoint])).toBe(0)
  await expect(page.getByRole('complementary', { name: 'Add Widget' })).toBeVisible()
})

test('picker leaves the grid unobstructed on desktop and remains usable on a phone', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('button', { name: 'Add Widget' }).first().click()
  const dock = page.getByRole('complementary', { name: 'Add Widget' })
  const grid = page.getByRole('region', { name: 'Dashboard widgets' })
  const search = dock.getByRole('textbox', { name: 'Search widgets' })
  const list = dock.getByTestId('widget-picker-list')
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const searchBox = await search.boundingBox()
  const listBox = await list.boundingBox()
  expect(searchBox).not.toBeNull()
  expect(listBox).not.toBeNull()
  expect(searchBox!.y + searchBox!.height).toBeLessThan(listBox!.y)
  const desktopGrid = await grid.boundingBox()
  const desktopDock = await dock.boundingBox()
  expect(desktopGrid).not.toBeNull()
  expect(desktopDock).not.toBeNull()
  expect(desktopGrid!.x + desktopGrid!.width).toBeLessThanOrEqual(desktopDock!.x)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dock).toBeVisible()
  const mobileGrid = await grid.boundingBox()
  const mobileDock = await dock.boundingBox()
  expect(mobileDock!.y).toBeGreaterThanOrEqual(mobileGrid!.y + mobileGrid!.height - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await dock.getByRole('textbox', { name: 'Search widgets' }).fill('Vehicle Hero Card')
  await dock.getByRole('button', { name: /Vehicle Hero Card/ }).click()
  await expect(dock.getByRole('button', { name: /Vehicle Hero Card/ })).toBeDisabled()
  await dock.getByRole('button', { name: 'Close widget picker' }).click()
  await expect(dock).toHaveCount(0)
})

test('resize affordances are contained grips and a real resize persists', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await createCommuter(page)
  await page.getByRole('button', { name: 'Customize' }).click()
  const handle = page.locator('.react-resizable-handle-se').first()
  await expect(handle).toBeVisible()
  const styles = await handle.evaluate((element) => {
    const grip = getComputedStyle(element)
    const decoration = getComputedStyle(element, '::after')
    const item = element.closest('.react-grid-item')!.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      transform: decoration.transform,
      width: box.width,
      height: box.height,
      inside: box.right <= item.right && box.bottom <= item.bottom,
      cursor: grip.cursor,
    }
  })
  expect(styles).toMatchObject({ transform: 'none', width: 30, height: 30, inside: true, cursor: 'se-resize' })
  const before = await readLayouts(page)
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 105, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => JSON.stringify(await readLayouts(page))).not.toBe(JSON.stringify(before))
  const after = await readLayouts(page)
  expect(countOverlaps(after.md)).toBe(0)
  const resizedId = before.md.find((item) => {
    const next = after.md.find((candidate) => candidate.i === item.i)
    return next && (item.w !== next.w || item.h !== next.h)
  })?.i
  expect(resizedId).toBeDefined()
  expect(after.md.find((item) => item.i === resizedId)).toMatchObject({ userSized: true })
})

test('new widgets fit their content across desktop, tablet, and phone widths', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await createCommuter(page)
  await waitForHarnessReady(page, mockApi)
  await page.getByRole('button', { name: /customize/i }).click()
  await page.getByRole('button', { name: 'Add Widget' }).first().click()
  await page.getByRole('complementary', { name: 'Add Widget' })
    .getByRole('button', { name: /Vehicle Hero Card/ }).click()

  const instanceId = await page.evaluate(() => {
    const dashboards = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{
      id: string
      widgets: Array<{ id: string; widgetId: string }>
    }>
    const active = localStorage.getItem('teslasync-active-dashboard')
    return dashboards.find((d) => d.id === active)?.widgets.find((w) => w.widgetId === 'vehicle-hero-card')?.id
  })

  expect(instanceId).toBeTruthy()
  const widget = page.locator(`[data-widget-id="${instanceId}"]`)
  await expect(widget).toBeVisible()
  await expect(widget.locator('.overflow-auto')).toBeVisible()

  for (const width of [1920, 1440, 1200, 1024, 996, 768, 481, 480, 390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    if (width === 390) {
      await expect(page.getByRole('button', { name: 'Add Widget', exact: true })).toBeVisible()
    }
    await expect.poll(async () => widget.evaluate((element) => {
      const panel = element.querySelector<HTMLElement>('.widget-panel')
      const content = panel?.querySelector<HTMLElement>('.overflow-auto')
      if (!panel || !content) return Number.POSITIVE_INFINITY
      return Math.max(panel.scrollHeight - panel.clientHeight, content.scrollHeight - content.clientHeight)
    }), { message: `widget must fit without an inner scrollbar at ${width}px` }).toBeLessThanOrEqual(4)
    await expect.poll(() => widget.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= -1 && rect.right <= window.innerWidth + 1
    }), { message: `widget extends beyond the ${width}px viewport` }).toBe(true)
    // Edit-mode resize handles intentionally extend 4px past the last grid column.
    await expect.poll(
      async () => page.locator('[data-tour="dashboard-grid"]').evaluate(
        (grid) => grid.scrollWidth - grid.clientWidth,
      ),
      { message: `dashboard must not overflow horizontally at ${width}px` },
    ).toBeLessThanOrEqual(5)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  const dock = page.getByRole('complementary', { name: 'Add Widget' })
  for (const [label, widgetId, minRows] of [
    ['Export Status', 'export-status', 2],
    ['Digital Twin', 'vehicle-twin', 4],
    ['Software Update', 'software-update-status', 2],
    ['Automation History', 'automation-history', 2],
  ] as const) {
    await dock.getByRole('textbox', { name: 'Search widgets' }).fill(label)
    await dock.getByRole('button', { name: new RegExp(`^${label} `) }).first().click()
    const addedId = await page.evaluate((id) => {
      const dashboards = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{
        id: string
        widgets: Array<{ id: string; widgetId: string }>
      }>
      return dashboards.find((d) => d.id === localStorage.getItem('teslasync-active-dashboard'))
        ?.widgets.find((w) => w.widgetId === id)?.id
    }, widgetId)
    expect(addedId, `${label} was saved`).toBeTruthy()
    await expect.poll(async () =>
      (await readLayouts(page)).md.find((item) => item.i === addedId)?.h ?? 0,
      { message: `${label} should not collapse below its minimum size` },
    ).toBeGreaterThanOrEqual(minRows)
    const panel = page.locator(`[data-widget-id="${addedId}"] .widget-panel`)
    await expect.poll(async () => panel.evaluate((element) => {
      const nested = [...element.querySelectorAll<HTMLElement>('*')]
        .filter((child) => ['auto', 'scroll'].includes(getComputedStyle(child).overflowY))
        .map((child) => child.scrollHeight - child.clientHeight)
      return Math.max(element.scrollHeight - element.clientHeight, ...nested, 0)
    }), {
      message: `${label} should not need a scrollbar on initial add`,
    }).toBeLessThanOrEqual(4)
    await expect.poll(
      () => panel.evaluate((element) => element.getBoundingClientRect().height),
      { message: `${label} should settle at its saved minimum height` },
    ).toBeGreaterThanOrEqual(minRows * 80)
  }
  const previousHeight = (await readLayouts(page)).md.find((item) => item.i === instanceId)?.h ?? 0
  await widget.locator('.overflow-auto').evaluate((content) => {
    const lateContent = document.createElement('div')
    lateContent.dataset.autofitProbe = 'true'
    lateContent.style.height = '600px'
    content.appendChild(lateContent)
  })
  await expect.poll(async () =>
    (await readLayouts(page)).md.find((item) => item.i === instanceId)?.h ?? 0,
  ).toBeGreaterThan(previousHeight)
  await expect.poll(async () => widget.locator('.overflow-auto').evaluate(
    (content) => content.scrollHeight - content.clientHeight,
  )).toBeLessThanOrEqual(4)
  await widget.locator('[data-autofit-probe]').evaluate((probe) => probe.remove())
  await expect.poll(async () =>
    (await readLayouts(page)).md.find((item) => item.i === instanceId)?.h ?? 0,
  ).toBe(previousHeight)
  await page.waitForTimeout(1200)
  expect((await readLayouts(page)).md.find((item) => item.i === instanceId)?.h).toBe(previousHeight)
})

test('repairs oversized saved panels without undoing an explicit resize', async ({ page }) => {
  test.setTimeout(180_000)
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await createCommuter(page)
  const saved = await page.evaluate(() => {
    const dashboards = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{
      id: string
      widgets: Array<{ id: string; widgetId: string }>
      layouts: Record<string, LayoutItem[]>
    }>
    const active = dashboards.find((dash) => dash.id === localStorage.getItem('teslasync-active-dashboard'))!
    const bloated = active.widgets.find((widget) => widget.widgetId === 'battery-gauge')!
    const deliberate = active.widgets.find((widget) => widget.widgetId === 'charge-status')!
    for (const items of Object.values(active.layouts)) {
      for (const item of items) {
        if (item.i === bloated.id) item.h = 30
        if (item.i === deliberate.id) Object.assign(item, { h: 25, userSized: true })
      }
    }
    localStorage.setItem('teslasync-dashboards', JSON.stringify(dashboards))
    return { bloatedId: bloated.id, deliberateId: deliberate.id }
  })

  const restored = await page.context().newPage()
  expect((await readLayouts(page)).md.find((item) => item.i === saved.deliberateId)?.h).toBe(25)
  await seedBrowserState(restored, 'dark', '/', { preserveDashboardState: true })
  await restored.addInitScript(() => {
    (window as Window & { initialDashboardLayouts?: string }).initialDashboardLayouts =
      localStorage.getItem('teslasync-dashboards') ?? ''
  })
  const restoredApi = await installApiMocks(restored, 'populated')
  await restored.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(restored, restoredApi)
  expect(await restored.evaluate((id) => {
    const raw = (window as Window & { initialDashboardLayouts?: string }).initialDashboardLayouts ?? '[]'
    const dashboards = JSON.parse(raw) as Array<{ id: string; layouts: Record<string, LayoutItem[]> }>
    return dashboards.find((dash) => dash.id === localStorage.getItem('teslasync-active-dashboard'))
      ?.layouts.md.find((item) => item.i === id)
  }, saved.deliberateId)).toMatchObject({ h: 25, userSized: true })
  await expect.poll(async () =>
    (await readLayouts(restored)).md.find((item) => item.i === saved.bloatedId)?.h ?? 30,
  ).toBeLessThan(15)
  expect((await readLayouts(restored)).md.find((item) => item.i === saved.deliberateId)).toMatchObject({ h: 25, userSized: true })
  const healed = await readLayouts(restored)
  expect(countOverlaps(healed.md)).toBe(0)
  await restored.waitForTimeout(2500)
  expect((await readLayouts(restored)).md.find((item) => item.i === saved.bloatedId)?.h)
    .toBe(healed.md.find((item) => item.i === saved.bloatedId)?.h)
  const context = page.context()
  await restored.close()
  await page.close()
  let reloaded = await context.newPage()
  await seedBrowserState(reloaded, 'dark', '/', { preserveDashboardState: true })
  const reloadedApi = await installApiMocks(reloaded, 'populated')
  await reloaded.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(reloaded, reloadedApi)
  expect((await readLayouts(reloaded)).md.find((item) => item.i === saved.bloatedId)?.h)
    .toBe(healed.md.find((item) => item.i === saved.bloatedId)?.h)
  for (const width of [320, 390, 480, 481, 768, 996, 1024, 1200, 1440, 1920]) {
    await reloaded.close()
    reloaded = await context.newPage()
    await reloaded.setViewportSize({ width, height: 900 })
    await seedBrowserState(reloaded, 'dark', '/', { preserveDashboardState: true })
    const viewportApi = await installApiMocks(reloaded, 'populated')
    await reloaded.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(reloaded, viewportApi)
    const panel = reloaded.locator(`[data-widget-id="${saved.bloatedId}"] .widget-panel`)
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().height), {
      message: `oversized saved panel should not return after reopening at ${width}px`,
    }).toBeLessThan(1300)
    await expect.poll(() => panel.evaluate((element) => element.scrollHeight - element.clientHeight), {
      message: `repaired widget content should fit at ${width}px`,
    }).toBeLessThanOrEqual(4)
    const layouts = await readLayouts(reloaded)
    expect(layouts.md.find((item) => item.i === saved.deliberateId)).toMatchObject({ h: 25, userSized: true })
    for (const items of Object.values(layouts)) expect(countOverlaps(items)).toBe(0)
  }
  await reloaded.close()
})

test('repairs oversized layouts restored from the server and syncs the healed size', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated')
  const serverDashboard = {
    id: 'from-server', name: 'From server',
    widgets: [
      { id: 'server-nav', widgetId: 'quick-nav' },
      { id: 'server-charge', widgetId: 'charge-status' },
      { id: 'server-hero', widgetId: 'vehicle-hero' },
    ],
    layouts: Object.fromEntries(['lg', 'md', 'sm', 'xs'].map((bp) => [
      bp, [
        { i: 'server-nav', x: 0, y: 0, w: bp === 'xs' ? 1 : 2, h: 30 },
        { i: 'server-charge', x: 0, y: 30, w: bp === 'xs' ? 1 : 2, h: 2 },
        { i: 'server-hero', x: 0, y: 32, w: bp === 'xs' ? 1 : 2, h: 9 },
      ],
    ])),
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
  }
  const saves: Array<{ dashboards: Array<typeof serverDashboard> }> = []
  await page.route('**/api/v1/settings/dashboard-layouts', async (route) => {
    if (route.request().method() === 'PUT') {
      saves.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { dashboards: saves.at(-1)?.dashboards, active_id: serverDashboard.id } })
      return
    }
    await route.fulfill({ status: 200, json: { dashboards: [serverDashboard], active_id: serverDashboard.id } })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  await expect.poll(async () =>
    (await readLayouts(page)).md.find((item) => item.i === 'server-nav')?.h ?? 30,
  ).toBeLessThan(10)
  await expect.poll(() => saves.at(-1)?.dashboards[0]?.layouts.md.find((item) => item.i === 'server-nav')?.h ?? 30)
    .toBeLessThan(10)
  await expect.poll(async () =>
    (await readLayouts(page)).md.find((item) => item.i === 'server-hero')?.h ?? 9,
  ).toBeLessThanOrEqual(8)
  await expect.poll(() => page.locator('[data-widget-id="server-hero"] .widget-panel').evaluate((panel) =>
    panel.scrollHeight - panel.clientHeight,
  )).toBeLessThanOrEqual(4)
  expect(countOverlaps((await readLayouts(page)).md)).toBe(0)
})
