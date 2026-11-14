const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

const web = path.resolve(__dirname, '..', '..', '..', '..', 'web');
process.chdir(web);
process.env.E2E_BASE_URL ??= 'http://127.0.0.1:5173';
process.env.E2E_MOCKS = '1';

const webRequire = Module.createRequire(path.join(web, 'package.json'));
const { chromium } = webRequire('@playwright/test');
const esbuild = webRequire('esbuild');
const selector = '[data-action-zone="context"] > section > div > button[aria-haspopup="menu"]';
const savedName = 'Implementation review - synthetic data';

async function loadFixtures() {
  const compiled = await esbuild.build({
    stdin: {
      contents: "export { installPackReview, createReviewPreference } from './e2e/widget-design-packs.mock'; export { closeMockApiFixtures } from './e2e/mockApi';",
      resolveDir: web,
      sourcefile: 'warm-dom-check-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'empty' },
    write: false,
    logLevel: 'silent',
  });
  const filename = path.join(web, '__warm_dom_check_in_memory__.cjs');
  const virtual = new Module(filename);
  virtual.filename = filename;
  virtual.paths = Module._nodeModulePaths(web);
  virtual._compile(compiled.outputFiles[0].text, filename);
  return virtual.exports;
}

async function measure(page) {
  return page.evaluate(selector => {
    const button = document.querySelector(selector);
    const name = button.querySelector('span.truncate');
    const caption = button.querySelector('span:first-child');
    const icon = button.querySelector(':scope > svg:last-child');
    const zone = button.closest('[data-action-zone="context"]');
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const lines = node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].map(r => ({
        left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      }));
    };
    const cs = getComputedStyle(caption);
    const ns = getComputedStyle(name);
    const preserved = document.querySelector('#warm-protected-dom-check span.truncate');
    const ps = getComputedStyle(preserved);
    return {
      text: name.textContent,
      name: rect(name), nameLines: lines(name), nameOverflow: ns.overflow,
      nameWhitespace: ns.whiteSpace, nameTextOverflow: ns.textOverflow,
      nameClientWidth: name.clientWidth, nameScrollWidth: name.scrollWidth,
      nameClientHeight: name.clientHeight, nameScrollHeight: name.scrollHeight,
      caption: rect(caption), captionLines: lines(caption),
      captionWhitespace: cs.whiteSpace, captionShrink: cs.flexShrink,
      button: rect(button), zone: rect(zone), icon: rect(icon),
      badges: [...button.querySelectorAll('[data-warm-test-badge]')].map(badge => ({
        ...rect(badge), text: badge.textContent, clientWidth: badge.clientWidth,
        scrollWidth: badge.scrollWidth, clientHeight: badge.clientHeight, scrollHeight: badge.scrollHeight,
      })),
      viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
      protectedCSS: [ps.whiteSpace, ps.overflow, ps.textOverflow],
      protectedOwnerCount: document.querySelectorAll('[data-app-design-preserve][data-app-design-owner], [data-app-design-preserve] [data-app-design-owner]').length,
      actualProtectedCount: document.querySelectorAll('[data-app-design-preserve]:not(#warm-protected-dom-check)').length,
    };
  }, selector);
}

async function configure(page, scale, text, badges) {
  await page.evaluate(({ selector, scale, text, badges }) => {
    document.documentElement.style.setProperty('--font-scale', String(scale));
    const button = document.querySelector(selector);
    button.querySelector('span.truncate').textContent = text;
    button.querySelectorAll('[data-warm-test-badge]').forEach(badge => badge.remove());
    const icon = button.querySelector(':scope > svg:last-child');
    for (const [label, variant] of badges ? [['modified', 'warning'], ['Aurora', 'neutral']] : []) {
      const badge = document.createElement('span');
      badge.setAttribute('data-warm-test-badge', '');
      badge.setAttribute('data-app-part', 'badge');
      badge.setAttribute('data-app-variant', variant);
      badge.setAttribute('data-app-design-owner', button.getAttribute('data-app-design-owner'));
      badge.className = 'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full whitespace-normal break-words font-medium border ml-1 px-1.5 py-0 text-2xs';
      if (variant === 'neutral') {
        const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        pin.setAttribute('class', 'mr-1 inline h-2.5 w-2.5');
        pin.setAttribute('aria-hidden', 'true');
        badge.appendChild(pin);
      }
      badge.appendChild(document.createTextNode(label));
      button.insertBefore(badge, icon);
    }
  }, { selector, scale, text, badges });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function check(d, label, text, shouldWrap) {
  const verify = (condition, reason) => assert.ok(condition, `${label}: ${reason}: ${JSON.stringify(d)}`);
  assert.equal(d.text, text, `${label}: text`);
  assert.equal(d.nameWhitespace, 'normal', `${label}: name whitespace`);
  assert.equal(d.nameOverflow, 'visible', `${label}: name overflow`);
  assert.equal(d.nameTextOverflow, 'clip', `${label}: name text-overflow`);
  verify(shouldWrap ? d.nameLines.length >= 2 : d.nameLines.length === 1, 'unexpected name wrapping');
  verify(d.nameScrollWidth <= d.nameClientWidth + 1 && d.nameScrollHeight <= d.nameClientHeight + 1, 'name clipped');
  verify(d.nameLines.every(line => line.left >= d.name.left - 1 && line.right <= d.name.right + 1
    && line.top >= d.name.top - 1 && line.bottom <= d.name.bottom + 1), 'text outside name');
  assert.equal(d.captionLines.length, 1, `${label}: caption split`);
  assert.equal(d.captionWhitespace, 'nowrap', `${label}: caption whitespace`);
  assert.equal(d.captionShrink, '0', `${label}: caption shrink`);
  verify(d.button.height >= 44 && d.button.width >= 44, 'touch target too small');
  verify(d.button.left >= -1 && d.button.right <= d.zone.right + 1 && d.button.right <= d.viewport + 1, 'button outside zone');
  verify(d.caption.right <= d.name.left + 1 && d.name.right <= d.icon.left + 1, 'name or caption overlaps icon');
  verify(d.icon.width >= 10, 'icon collapsed');
  verify(d.badges.every(badge => badge.left >= d.button.left - 1 && badge.right <= d.button.right + 1
    && badge.top >= d.button.top - 1 && badge.bottom <= d.button.bottom + 1
    && badge.scrollWidth <= badge.clientWidth + 1 && badge.scrollHeight <= badge.clientHeight + 1), 'badge clipped');
  const contents = [d.caption, d.name, ...d.badges, d.icon];
  for (let i = 0; i < contents.length; i++) {
    for (let j = i + 1; j < contents.length; j++) {
      const a = contents[i], b = contents[j];
      verify(a.right <= b.left + 1 || b.right <= a.left + 1
        || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'button contents overlap');
    }
  }
  verify(d.documentWidth <= d.viewport + 1, 'horizontal page overflow');
  assert.deepEqual(d.protectedCSS, ['nowrap', 'hidden', 'ellipsis'], `${label}: protected CSS`);
  assert.equal(d.protectedOwnerCount, 0, `${label}: protected owner leakage`);
  verify(d.actualProtectedCount >= 1, 'actual Digital Twin protected subtree missing');
}

(async () => {
  const { installPackReview, createReviewPreference, closeMockApiFixtures } = await loadFixtures();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-networking'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const preference = createReviewPreference();
    preference.pack_id = 'warm';
    preference.app_wide = true;
    await installPackReview(page, 'dark', 390, false,
      [['vehicle-twin', 'Digital Twin'], ['digital-twin-mini', 'Digital Twin Mini']],
      true, preference, process.env.E2E_BASE_URL, { font_scale: 1 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${process.env.E2E_BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.locator(selector).waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-app-design-pack') === 'warm'
      && document.querySelector('[data-action-zone="context"] button[aria-haspopup="menu"] > span.truncate')
        ?.getAttribute('data-app-design-owner')?.includes('pack-warm'), null, { timeout: 30000 });
    await page.waitForSelector('[data-app-design-preserve]', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'warm-protected-dom-check';
      host.setAttribute('data-app-design-preserve', '');
      const clone = document.querySelector('[data-action-zone="context"]').cloneNode(true);
      clone.querySelectorAll('[data-app-design-owner]').forEach(node => node.removeAttribute('data-app-design-owner'));
      clone.removeAttribute('data-app-design-owner');
      host.appendChild(clone);
      document.body.appendChild(host);
    });

    let checks = 0;
    for (const forcedColors of ['none', 'active']) {
      await page.emulateMedia({ forcedColors });
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const scale of [0.85, 1, 1.35]) {
          for (const [scenario, text, badges, shouldWrap] of [
            ['saved', savedName, false, true],
            ['unbroken', 'ExtraordinarilyLongUninterruptedSavedLayoutName', false, true],
            ['modified-and-pinned', savedName, true, true],
            ['short', 'Daily', false, false],
          ]) {
            await configure(page, scale, text, badges);
            const d = await measure(page);
            const label = `${width}px scale=${scale} forced-colors=${forcedColors} ${scenario}`;
            if (scale === 1 && forcedColors === 'none') {
              console.log(`${label}: lines=${d.nameLines.length} caption=${d.captionLines.length} button=${d.button.width.toFixed(1)}x${d.button.height.toFixed(1)} zone=${d.zone.width.toFixed(1)} icon=${d.icon.width.toFixed(1)} doc=${d.documentWidth}/${d.viewport} protected=${d.actualProtectedCount}`);
            }
            check(d, label, text, shouldWrap);
            checks++;
          }
        }
      }
    }
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 1024, height: 844 });
    await configure(page, 1, savedName, false);
    const desktop = await measure(page);
    assert.equal(desktop.nameWhitespace, 'nowrap', 'desktop whitespace');
    assert.equal(desktop.nameOverflow, 'hidden', 'desktop overflow');
    assert.equal(desktop.nameTextOverflow, 'ellipsis', 'desktop text-overflow');
    await page.setViewportSize({ width: 390, height: 844 });
    await configure(page, 1, savedName, false);
    const switcher = page.locator(selector).first();
    await switcher.click();
    assert.equal(await switcher.getAttribute('aria-expanded'), 'true', 'menu opens');
    assert.equal(await page.getByRole('menu', { name: 'Saved layouts' }).count(), 1, 'saved layout menu');
    await switcher.click();
    assert.equal(await switcher.getAttribute('aria-expanded'), 'false', 'menu closes');
    assert.deepEqual(pageErrors, [], 'page errors');
    console.log(`PASS: ${checks} real-dashboard CSS checks; desktop, protected content and menu preserved; 0 screenshots.`);
  } finally {
    if (browser) await browser.close();
    await closeMockApiFixtures();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
