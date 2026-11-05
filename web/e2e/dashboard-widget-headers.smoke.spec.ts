import { expect, test } from '@playwright/test';
import { seedBrowserState, installApiMocks, waitForHarnessReady } from './mockApi';
for (const width of [375,768,1280,1920]) for (const theme of ['light','dark'] as const) {
 test(`header review ${width} ${theme}`, async ({page}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({width,height:1000});
  await page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'));
  await seedBrowserState(page, theme, '/', {preserveDashboardState:true});
  await page.addInitScript(() => {
   const ids=['vehicle-hero','battery-gauge','charge-status','security-status','climate-status','recent-drives'];
   const widgets=ids.map((widgetId,i)=>({id:`review-${i}`,widgetId,config:{vehicleId:1}}));
   const layouts=Object.fromEntries([['lg',4],['md',3],['sm',2],['xs',1]].map(([bp,c])=>[bp,ids.map((_,i)=>({i:`review-${i}`,x:(i%Number(c)),y:Math.floor(i/Number(c))*6,w:1,h:6}))]));
   localStorage.setItem('teslasync-dashboards',JSON.stringify([{id:'review',name:'Fleet operations',widgets,layouts,createdAt:'2026-09-13',updatedAt:'2026-09-13',isDefault:true}]));
   localStorage.setItem('teslasync-active-dashboard','review');
   localStorage.setItem('teslasync-row-height-version','2');
  });
  const mocks=await installApiMocks(page,'populated',theme);
  await page.goto('/'); await waitForHarnessReady(page,mocks);
  const measure = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-widget-id^="review-"]')).map(root => {
   const header = root.querySelector<HTMLElement>('[data-role="widget-shell-header"]')!;
   const title = header?.querySelector<HTMLElement>('[data-role="widget-header-title"]');
   const dots = root.querySelectorAll<HTMLElement>('[data-role="freshness-dot"]');
   if (!header || !title || dots.length !== 1) return { id: root.dataset.widgetId, valid: false };
   const dot = dots[0].getBoundingClientRect();
   const text = title.getBoundingClientRect();
   const padding = parseFloat(getComputedStyle(header).paddingLeft);
   const controls = Array.from(header.querySelectorAll<HTMLElement>('button, a[href]')).filter(el => !el.contains(dots[0]) && el.querySelector('svg')).map(el => el.getBoundingClientRect()).filter(rect => rect.width > 0).sort((a,b)=>a.left-b.left);
   const gaps = controls.map((rect,i)=>(controls[i+1]?.left ?? dot.left)-rect.right);
   return { id: root.dataset.widgetId, valid: header.contains(dots[0]) && Math.abs(root.getBoundingClientRect().right-padding-dot.right)<=2 && Math.abs((text.top+text.bottom-dot.top-dot.bottom)/2)<=2 && gaps.every(gap=>gap>=-2 && gap<=8), right: dot.right };
  }));
  const view = await measure();
  expect(view).toHaveLength(6);
  expect(view.every(row=>row.valid), JSON.stringify(view)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`dashboard-${width}-${theme}.png`),fullPage:true,animations:'disabled'});
  for (const panel of await page.locator('[data-widget-id^="review-"]').all()) await panel.hover();
  expect(await measure()).toEqual(view);
  await page.getByRole('button',{name:'Customize',exact:true}).click();
  const edit = await measure();
  expect(edit.every(row=>row.valid), JSON.stringify(edit)).toBe(true);
  expect(edit.map(row=>row.right)).toEqual(view.map(row=>row.right));
 });
}

for (const width of [375, 1440]) for (const theme of ['light', 'dark'] as const) {
 test(`charge-session caption and legend padding ${width} ${theme}`, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 1600 });
  await seedBrowserState(page, theme, '/', { preserveDashboardState: true });
  await page.addInitScript(() => {
   const layouts = Object.fromEntries([['lg', 4], ['md', 3], ['sm', 2], ['xs', 1]].map(([bp, cols]) => [
    bp, [{ i: 'charge-padding', x: 0, y: 0, w: Number(cols), h: 8 }],
   ]));
   localStorage.setItem('teslasync-dashboards', JSON.stringify([{
    id: 'charge-padding', name: 'Charge padding',
    widgets: [{ id: 'charge-padding', widgetId: 'charge-session-chart', config: { vehicleId: 1 } }],
    layouts, createdAt: '2026-09-13', updatedAt: '2026-09-13', isDefault: true,
   }]));
   localStorage.setItem('teslasync-active-dashboard', 'charge-padding');
   localStorage.setItem('teslasync-row-height-version', '2');
  });
  const mocks = await installApiMocks(page, 'populated', theme);
  let failRefresh = false;
  await page.route('**/api/v1/charging?*', route => route.fulfill({
   status: failRefresh ? 503 : 200,
   contentType: 'application/json',
   body: JSON.stringify(failRefresh ? { error: 'Temporarily unavailable' } : Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, vehicle_id: 1,
    started_at: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
    total_energy_added_wh: (index + 1) * 1000,
    charger_type: ['AC', 'SUPERCHARGER', 'DC', null][index % 4],
   }))),
  }));
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  const widget = page.locator('[data-widget-id="charge-padding"]');
  const caption = widget.getByText('Energy per session', { exact: false });
  await expect(caption).toBeVisible();
  await expect(widget.getByText('Home / AC', { exact: true })).toBeVisible();

  for (const state of ['fresh', 'stale'] as const) {
   if (state === 'stale') {
    failRefresh = true;
    await widget.getByRole('button', { name: /Refresh data/ }).click();
    await expect(widget.getByTestId('stale-refresh-warning')).toBeVisible({ timeout: 30000 });
   }
   await expect.poll(() => widget.evaluate(root => {
    const body = root.querySelector<HTMLElement>('[data-testid="widget-body"]')!;
    const header = root.querySelector<HTMLElement>('[data-role="widget-shell-header"]')!;
    const caption = Array.from(body.querySelectorAll('p')).find(el => el.textContent?.includes('Energy per session'))!;
    const legend = Array.from(body.querySelectorAll('ul')).find(el => el.textContent?.includes('Home / AC'))!;
    const bodyRect = body.getBoundingClientRect();
    const captionRect = caption.getBoundingClientRect();
    const legendRect = legend.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(header).paddingLeft);
    return {
     captionAligned: Math.abs(captionRect.left - bodyRect.left - inset) <= 1,
     legendAligned: Math.abs(legendRect.left - bodyRect.left - inset) <= 1,
     rightInset: bodyRect.right - legendRect.right >= inset - 1,
     bottomInset: bodyRect.bottom - legendRect.bottom >= 11,
     noOverflow: body.scrollWidth <= body.clientWidth && body.scrollHeight <= body.clientHeight + 1,
    };
   })).toEqual({ captionAligned: true, legendAligned: true, rightInset: true, bottomInset: true, noOverflow: true });
   await widget.screenshot({ path: testInfo.outputPath(`charge-padding-${width}-${theme}-${state}.png`), animations: 'disabled' });
  }
 });
}
