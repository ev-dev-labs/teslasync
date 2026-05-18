const { chromium } = require('playwright');

const TOUR_IDS = ['main', 'alerts', 'charging', 'drives', 'vehicles', 'automations', 'settings', 'debugger'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  await context.addInitScript((tourIds) => {
    localStorage.setItem('teslasync-onboarded', 'true');
    localStorage.setItem('teslasync:onboarding:skipped:v1', '1');

    localStorage.setItem('teslasync-theme', 'neon-cyan');
    localStorage.setItem('teslasync:theme:id', 'neon-cyan');

    for (const id of tourIds) {
      for (let v = 1; v <= 5; v++) {
        localStorage.setItem(`teslasync:tour:v${v}:${id}`, 'completed');
      }
    }
    localStorage.setItem('teslasync-tour-completed', 'true');
    localStorage.setItem('teslasync:tour:list-seen', '1');

    localStorage.setItem('teslasync:checklist:dismissed', '1');
    localStorage.setItem('teslasync:cp-discovered', '1');
    localStorage.setItem('teslasync:checklist:customizeDashboard', '1');

    localStorage.setItem('teslasync:whats-new:dismissed', '1');
    localStorage.setItem('teslasync:dev-banner:dismissed', '1');

    // Suppress the ChangelogModal that auto-opens on first visit to a new
    // version. Setting a far-future "seen-version" + a recent "last-shown"
    // makes the modal think the user has already acknowledged the latest.
    localStorage.setItem('teslasync:changelog:seen-version', '99.0.0');
    localStorage.setItem('teslasync:changelog:last-shown', String(Date.now()));

    // Seed a clean dashboard layout that omits the onboarding-checklist
    // widget — otherwise the dashboard renders a "Setup checklist hidden"
    // placeholder card because the widget self-hides without being removed
    // from the layout. Leaving `layouts: {}` lets the grid auto-position.
    const now = new Date().toISOString();
    const cleanDashboard = [{
      id: 'default',
      name: 'Default',
      widgets: [
        { id: 'default-1', widgetId: 'vehicle-hero' },
        { id: 'default-2', widgetId: 'battery-gauge' },
        { id: 'default-3', widgetId: 'climate-status' },
        { id: 'default-4', widgetId: 'recent-drives' },
        { id: 'default-5', widgetId: 'charge-status' },
        { id: 'default-6', widgetId: 'security-status' },
        { id: 'default-7', widgetId: 'quick-nav' },
      ],
      layouts: {},
      createdAt: now,
      updatedAt: now,
      isDefault: true,
    }];
    localStorage.setItem('teslasync-dashboards', JSON.stringify(cleanDashboard));
    localStorage.setItem('teslasync-active-dashboard', 'default');
  }, TOUR_IDS);

  const base = 'http://localhost:3000';
  const outDir = 'D:\\repos\\teslasync\\docs\\public\\screenshots';

  const pages = [
    { path: '/',                              name: 'dashboard',          wait: 4000 },
    { path: '/live',                          name: 'live-map',           wait: 4000 },
    { path: '/alert-studio',                  name: 'alert-studio',       wait: 3500 },
    { path: '/drives',                        name: 'drives',             wait: 3000 },
    { path: '/charging',                      name: 'charging',           wait: 3000 },
    { path: '/energy',                        name: 'energy-flow',        wait: 3000 },
    { path: '/live-monitor',                  name: 'diagnostics',        wait: 3000 },
    { path: '/anomaly-detection',             name: 'anomaly-detection',  wait: 3500 },
    { path: '/settings',                      name: 'settings',           wait: 2500 },
    { path: '/vehicles',                      name: 'vehicles',           wait: 3000 },
  ];

  for (const p of pages) {
    const page = await context.newPage();
    try {
      await page.goto(base + p.path, { waitUntil: 'networkidle', timeout: 20000 });
    } catch {
      try { await page.goto(base + p.path, { waitUntil: 'load', timeout: 15000 }); }
      catch (e) { console.log(`SKIP ${p.name}: ${e.message}`); await page.close(); continue; }
    }
    await page.waitForTimeout(p.wait);

    await page.evaluate(() => {
      const sels = [
        '[data-tour-overlay]',
        '[data-tour-popover]',
        '.shepherd-element',
        '.shepherd-modal-overlay-container',
        '.driver-overlay',
        '.driver-popover',
        '[data-checklist]',
        '[data-checklist-root]',
        '[data-onboarding-checklist]',
        '[aria-label="Onboarding checklist"]',
        '[aria-label="Guided tour"]',
        '[role="dialog"][data-onboarding]',
        '[role="dialog"][aria-labelledby*="changelog" i]',
        '[role="dialog"][aria-label*="What" i]',
        '.toast',
        '.toaster',
        '[data-sonner-toaster]',
        '[data-radix-toast-root]',
      ];
      for (const s of sels) {
        document.querySelectorAll(s).forEach((el) => el.remove());
      }

      // Remove the onboarding-checklist dashboard widget by walking from its
      // testid up to the nearest react-grid-layout item and yanking the whole
      // tile. The hidden-state placeholder ("Setup checklist hidden") doesn't
      // carry the testid, so also match on the unique placeholder text.
      const removeWidget = (el) => {
        if (!el) return;
        const gridItem = el.closest('.react-grid-item, [data-grid], [class*="grid-item"]');
        (gridItem || el).remove();
      };
      removeWidget(document.querySelector('[data-testid="onboarding-checklist"]'));
      document.querySelectorAll('h3, [class*="title"], [class*="Title"]').forEach((el) => {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === 'get started' || text === 'setup checklist hidden') {
          removeWidget(el);
        }
      });

      // Close the ChangelogModal ("What's new in TeslaSync") if it still
      // managed to open before our localStorage seed took effect.
      const modalHeadings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'));
      for (const h of modalHeadings) {
        if ((h.textContent || '').toLowerCase().includes("what's new in teslasync")) {
          const dialog = h.closest('[role="dialog"], .modal, [data-modal]');
          if (dialog) dialog.remove();
          // Also remove any sibling overlay/backdrop.
          document.querySelectorAll('.modal-backdrop, [data-modal-backdrop], [class*="overlay"][class*="modal"]').forEach((el) => el.remove());
          break;
        }
      }
    });

    try {
      const closeSel = '[aria-label="Close"], [aria-label="Dismiss"], [data-dismiss], .toast-close, [data-tour-close]';
      const close = page.locator(closeSel).first();
      if (await close.isVisible({ timeout: 300 })) await close.click({ timeout: 500 });
    } catch {}

    await page.waitForTimeout(300);

    await page.screenshot({ path: `${outDir}\\${p.name}.png`, fullPage: false });
    console.log(`OK ${p.name}`);
    await page.close();
  }

  await browser.close();
  console.log('\nAll screenshots captured!');
})();
