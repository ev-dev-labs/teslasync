const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  // Dismiss onboarding wizard before any page loads
  await context.addInitScript(() => {
    localStorage.setItem('teslasync-onboarded', 'true');
    localStorage.setItem('teslasync-theme', 'neon-cyan');
  });

  const base = 'http://localhost:3000';
  const outDir = 'D:\\repos\\teslasync\\docs\\public\\screenshots';

  const pages = [
    { path: '/',              name: 'dashboard',      wait: 3000 },
    { path: '/map',           name: 'live-map',       wait: 3000 },
    { path: '/alert-studio',  name: 'alert-studio',   wait: 3000 },
    { path: '/drives',        name: 'drives',         wait: 2000 },
    { path: '/charging',      name: 'charging',       wait: 2000 },
    { path: '/energy',        name: 'energy-flow',    wait: 2000 },
    { path: '/diagnostics/signal-monitor', name: 'diagnostics', wait: 2000 },
    { path: '/settings',      name: 'settings',       wait: 2000 },
    { path: '/vehicles',      name: 'vehicles',       wait: 2000 },
  ];

  for (const p of pages) {
    const page = await context.newPage();
    try {
      await page.goto(base + p.path, { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      await page.goto(base + p.path, { waitUntil: 'load', timeout: 10000 });
    }
    await page.waitForTimeout(p.wait);

    // Dismiss any modals/toasts that may have appeared
    try {
      const closeBtn = page.locator('[aria-label="Close"], [data-dismiss], .toast-close').first();
      if (await closeBtn.isVisible({ timeout: 500 })) await closeBtn.click();
    } catch {}

    await page.screenshot({ path: `${outDir}\\${p.name}.png`, fullPage: false });
    console.log(`OK ${p.name}`);
    await page.close();
  }

  await browser.close();
  console.log('\nAll screenshots captured!');
})();
