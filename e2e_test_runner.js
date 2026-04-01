const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const WEB_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:8080';
const OUTPUT_DIR = 'D:\\copilot\\teslasync\\testplan-updated';
const TOTAL_ITERATIONS = 20;

const PAGES = [
  { name: 'Dashboard', path: '/' },
  { name: 'Drives', path: '/drives' },
  { name: 'Charging', path: '/charging' },
  { name: 'LiveMap', path: '/live' },
  { name: 'Vehicles', path: '/vehicles' },
  { name: 'Energy', path: '/energy' },
  { name: 'BatteryHealth', path: '/battery' },
  { name: 'TirePressure', path: '/tire-pressure' },
  { name: 'DrivetrainHealth', path: '/drivetrain-health' },
  { name: 'ClimateControl', path: '/climate-control' },
  { name: 'SecurityAccess', path: '/security-access' },
  { name: 'MediaPlayer', path: '/media-player' },
  { name: 'Analytics', path: '/analytics' },
  { name: 'Alerts', path: '/alerts' },
  { name: 'Geofences', path: '/geofences' },
  { name: 'Settings', path: '/settings' },
  { name: 'SystemStatus', path: '/system-status' },
  { name: 'SoftwareUpdates', path: '/software-updates' },
  { name: 'VampireDrain', path: '/vampire-drain' },
  { name: 'Notifications', path: '/notifications' },
  { name: 'DataRepair', path: '/data-repair' },
  { name: 'Mileage', path: '/mileage' },
  { name: 'Commands', path: '/commands' },
  { name: 'Timeline', path: '/timeline' },
  { name: 'Locations', path: '/locations' },
  { name: 'ProjectedRange', path: '/projected-range' },
  { name: 'Efficiency', path: '/efficiency' },
  { name: 'Trips', path: '/trips' },
  { name: 'Statistics', path: '/statistics' },
  { name: 'Roadmap', path: '/roadmap' },
  { name: 'Changelog', path: '/changelog' },
  { name: 'Compare', path: '/compare' },
  { name: 'Admin', path: '/admin' },
  { name: 'ApiLogs', path: '/api-logs' },
  { name: 'DevTools', path: '/dev-tools' },
  { name: 'DrivingDynamics', path: '/driving-dynamics' },
  { name: 'ChargingCurve', path: '/charging-curve' },
  { name: 'CostAnalysis', path: '/cost-analysis' },
  { name: 'BatteryCells', path: '/battery-cells' },
  { name: 'DriveScore', path: '/drive-score' },
  { name: 'WeeklyDigest', path: '/weekly-digest' },
  { name: 'Maintenance', path: '/maintenance' },
  { name: 'DataExport', path: '/data-export' },
  { name: 'EnergyFlow', path: '/energy-flow' },
  { name: 'SafetySettings', path: '/safety-settings' },
  { name: 'Navigation', path: '/navigation' },
  { name: 'ApiKeys', path: '/api-keys' },
  { name: 'Chatbot', path: '/chatbot' },
  { name: 'QuickStats', path: '/quick-stats' },
];

const API_CHECKS = [
  { name: 'Health', url: `${API_URL}/healthz`, expect: 200 },
  { name: 'Ready', url: `${API_URL}/readyz`, expect: 200 },
  { name: 'Settings', url: `${API_URL}/api/v1/settings`, expect: 200 },
  { name: 'Vehicles', url: `${API_URL}/api/v1/vehicles`, expect: 200 },
  { name: 'Alerts', url: `${API_URL}/api/v1/alerts`, expect: 200 },
  { name: 'SystemStatus', url: `${API_URL}/api/v1/system/status`, expect: 200 },
];

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });
}

async function runIteration(iterNum, browser) {
  const dir = path.join(OUTPUT_DIR, `iteration-${iterNum}`);
  fs.mkdirSync(dir, { recursive: true });

  const results = {
    iteration: iterNum,
    timestamp: new Date().toISOString(),
    pages: [],
    apis: [],
    summary: {},
  };
  let passCount = 0;
  let failCount = 0;

  // API checks
  for (const check of API_CHECKS) {
    const res = await httpGet(check.url);
    const pass = res.status === check.expect;
    results.apis.push({ name: check.name, status: res.status, pass, error: res.error || null });
    if (pass) passCount++; else failCount++;
  }

  // Browser screenshots
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Dismiss onboarding / setup localStorage
  try {
    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(() => {
      localStorage.setItem('teslasync-onboarded', 'true');
      localStorage.setItem('onboarding-complete', 'true');
    });
  } catch (e) {
    // Continue even if this fails
  }

  for (const pg of PAGES) {
    try {
      await page.goto(`${WEB_URL}${pg.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);
      const screenshotPath = path.join(dir, `${pg.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      results.pages.push({ name: pg.name, path: pg.path, pass: true });
      passCount++;
    } catch (err) {
      results.pages.push({ name: pg.name, path: pg.path, pass: false, error: err.message.substring(0, 200) });
      failCount++;
      // Try to capture whatever is on screen
      try {
        await page.screenshot({ path: path.join(dir, `${pg.name}_error.png`) });
      } catch (_) {}
    }
  }

  await context.close();

  const total = passCount + failCount;
  results.summary = {
    total,
    pass: passCount,
    fail: failCount,
    rate: `${((passCount / total) * 100).toFixed(1)}%`,
  };

  // Save JSON results
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));

  // Save markdown summary
  let md = `# Iteration ${iterNum} Results\n\n`;
  md += `**Date**: ${results.timestamp}\n`;
  md += `**Pass**: ${passCount} | **Fail**: ${failCount} | **Rate**: ${results.summary.rate}\n\n`;
  md += `## API Checks\n\n`;
  for (const api of results.apis) {
    md += `- ${api.pass ? '✅' : '❌'} ${api.name}: HTTP ${api.status}${api.error ? ' (' + api.error + ')' : ''}\n`;
  }
  md += `\n## Page Screenshots (${results.pages.length} pages)\n\n`;
  for (const pg of results.pages) {
    md += `- ${pg.pass ? '✅' : '❌'} ${pg.name} (\`${pg.path}\`)${pg.error ? ': ' + pg.error : ''}\n`;
  }
  fs.writeFileSync(path.join(dir, 'results.md'), md);

  return results;
}

async function main() {
  console.log(`=== TeslaSync E2E Test Runner — ${TOTAL_ITERATIONS} Iterations ===`);
  console.log(`Pages: ${PAGES.length} | API checks: ${API_CHECKS.length}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  const browser = await chromium.launch({ headless: true });
  const allResults = [];

  for (let i = 1; i <= TOTAL_ITERATIONS; i++) {
    const start = Date.now();
    process.stdout.write(`Iteration ${i}/${TOTAL_ITERATIONS}... `);
    try {
      const result = await runIteration(i, browser);
      allResults.push(result);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`Pass: ${result.summary.pass}/${result.summary.total} (${result.summary.rate}) [${elapsed}s]`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      allResults.push({ iteration: i, error: err.message, summary: null });
    }
  }

  await browser.close();

  // Write overall summary
  let summaryMd = `# TeslaSync E2E Test Summary — ${TOTAL_ITERATIONS} Iterations\n\n`;
  summaryMd += `**Generated**: ${new Date().toISOString()}\n`;
  summaryMd += `**Pages tested**: ${PAGES.length}\n`;
  summaryMd += `**API endpoints tested**: ${API_CHECKS.length}\n`;
  summaryMd += `**Tests per iteration**: ${PAGES.length + API_CHECKS.length}\n\n`;

  summaryMd += '| Iteration | Pass | Fail | Total | Rate | Notes |\n';
  summaryMd += '|-----------|------|------|-------|------|-------|\n';

  let totalPass = 0, totalFail = 0, totalTests = 0;
  for (const r of allResults) {
    if (r.summary) {
      summaryMd += `| ${r.iteration} | ${r.summary.pass} | ${r.summary.fail} | ${r.summary.total} | ${r.summary.rate} | |\n`;
      totalPass += r.summary.pass;
      totalFail += r.summary.fail;
      totalTests += r.summary.total;
    } else {
      summaryMd += `| ${r.iteration} | - | - | - | ERROR | ${(r.error || '').substring(0, 50)} |\n`;
    }
  }

  summaryMd += `\n## Aggregate\n\n`;
  summaryMd += `- **Total tests run**: ${totalTests}\n`;
  summaryMd += `- **Total pass**: ${totalPass}\n`;
  summaryMd += `- **Total fail**: ${totalFail}\n`;
  summaryMd += `- **Overall rate**: ${totalTests > 0 ? ((totalPass / totalTests) * 100).toFixed(1) : 0}%\n`;

  // Page-level consistency
  if (allResults.length > 0 && allResults[0].pages) {
    summaryMd += `\n## Page Consistency Across Iterations\n\n`;
    summaryMd += '| Page | Pass Count | Fail Count | Consistency |\n';
    summaryMd += '|------|-----------|-----------|-------------|\n';
    for (const pg of PAGES) {
      let pPass = 0, pFail = 0;
      for (const r of allResults) {
        if (r.pages) {
          const found = r.pages.find(p => p.name === pg.name);
          if (found && found.pass) pPass++; else pFail++;
        }
      }
      const consistency = pPass === TOTAL_ITERATIONS ? '✅ 100%' : `⚠️ ${((pPass / TOTAL_ITERATIONS) * 100).toFixed(0)}%`;
      summaryMd += `| ${pg.name} | ${pPass} | ${pFail} | ${consistency} |\n`;
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.md'), summaryMd);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'all_results.json'), JSON.stringify(allResults, null, 2));

  console.log(`\n=== Complete. Summary: ${path.join(OUTPUT_DIR, 'summary.md')} ===`);
  console.log(`Overall: ${totalPass}/${totalTests} (${((totalPass / totalTests) * 100).toFixed(1)}%)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
