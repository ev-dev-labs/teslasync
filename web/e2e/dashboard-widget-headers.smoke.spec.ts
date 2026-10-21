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
   const headerBox = header.getBoundingClientRect();
   const text = title.getBoundingClientRect();
   const padding = parseFloat(getComputedStyle(header).paddingLeft);
   const controls = Array.from(header.querySelectorAll<HTMLElement>('button, a[href]')).filter(el => !el.contains(dots[0]) && el.querySelector('svg')).map(el => el.getBoundingClientRect()).filter(rect => rect.width > 0).sort((a,b)=>a.left-b.left);
   const gaps = controls.map((rect,i)=>(controls[i+1]?.left ?? dot.left)-rect.right);
   return { id: root.dataset.widgetId, valid: header.contains(dots[0]) && Math.abs(root.getBoundingClientRect().right-padding-dot.right)<=2 && Math.abs((text.top+text.bottom-dot.top-dot.bottom)/2)<=2 && gaps.every(gap=>gap>=-2 && gap<=8) && controls.every(rect=>rect.top>=headerBox.top && rect.bottom<=headerBox.bottom), right: dot.right };
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
