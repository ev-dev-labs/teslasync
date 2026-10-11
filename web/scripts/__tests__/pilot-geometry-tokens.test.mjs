import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import resolveConfig from 'tailwindcss/resolveConfig.js';
import classNameEscaping from 'tailwindcss/lib/util/escapeClassName.js';

const config = loadConfig(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)));
const dashboardSource = readFileSync(new URL('../../src/features/dashboard/pages/DashboardPage.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../../src/features/settings/pages/SettingsPage.tsx', import.meta.url), 'utf8');
const resolved = resolveConfig(config);

// Inherited page utilities are pinned independently of the new config values.
// Accept their exact named adoption later without changing this shared test.
const geometry = [
  {
    key: 'dashboard-kiosk',
    group: 'zIndex',
    property: 'z-index',
    value: '9990',
    literal: 'z-[9990]',
    utility: 'z-dashboard-kiosk',
    source: dashboardSource,
  },
  {
    key: 'dashboard-onboarding',
    group: 'gridTemplateColumns',
    property: 'grid-template-columns',
    value: 'minmax(0,1.2fr) minmax(22rem,0.8fr)',
    literal: 'xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]',
    utility: 'xl:grid-cols-dashboard-onboarding',
    source: dashboardSource,
  },
  {
    key: 'settings-navigation',
    group: 'gridTemplateColumns',
    property: 'grid-template-columns',
    value: '15rem minmax(0,1fr)',
    literal: 'lg:grid-cols-[15rem_minmax(0,1fr)]',
    utility: 'lg:grid-cols-settings-navigation',
    source: settingsSource,
  },
  {
    key: 'settings-shortcuts',
    group: 'gridTemplateColumns',
    property: 'grid-template-columns',
    value: 'repeat(auto-fit,minmax(min(100%,18rem),1fr))',
    literal: 'grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]',
    utility: 'grid-cols-settings-shortcuts',
    source: settingsSource,
  },
];

const css = await postcss([tailwindcss({
  ...config,
  content: [{ raw: geometry.flatMap(({ literal, utility }) => [literal, utility]).join(' '), extension: 'html' }],
})]).process('@tailwind utilities;', { from: undefined });

function generatedRule(utility) {
  const selector = `.${classNameEscaping.default(utility)}`;
  const matches = [];
  css.root.walkRules(selector, rule => {
    matches.push({
      declarations: rule.nodes.map(({ prop, value }) => [prop, value]),
      media: rule.parent.type === 'atrule' ? [rule.parent.name, rule.parent.params] : null,
    });
  });
  assert.equal(matches.length, 1, `Expected exactly one generated rule for ${utility}`);
  return matches[0];
}

for (const entry of geometry) {
  test(`${entry.key} exactly matches its inherited page literal`, () => {
    const inheritedValue = entry.literal.slice(entry.literal.indexOf('[') + 1, -1).replaceAll('_', ' ');
    assert.equal(config.theme.extend[entry.group][entry.key], entry.value);
    assert.equal(resolved.theme[entry.group][entry.key], entry.value);
    assert.equal(config.theme.extend[entry.group][entry.key], inheritedValue);
    assert.ok(entry.source.includes(entry.literal) || entry.source.includes(entry.utility), entry.utility);
  });

  test(`${entry.utility} preserves the CSS geometry and breakpoint of ${entry.literal}`, () => {
    const named = generatedRule(entry.utility);
    const inherited = generatedRule(entry.literal);
    assert.deepEqual(named.declarations, [[entry.property, entry.value]]);
    // Tailwind formats the arbitrary min() comma; the named value stays exact.
    const inheritedCssValue = entry.value.replace('min(100%,18rem)', 'min(100%, 18rem)');
    assert.deepEqual(inherited.declarations, [[entry.property, inheritedCssValue]]);
    assert.deepEqual(named.media, inherited.media);
    const breakpoint = entry.utility.startsWith('xl:') ? '1280px' : entry.utility.startsWith('lg:') ? '1024px' : null;
    assert.deepEqual(named.media, breakpoint ? ['media', `(min-width: ${breakpoint})`] : null);
  });
}

test('dashboard body portal remains below the unchanged presentation layer ladder', () => {
  const layers = config.theme.extend.zIndex;
  assert.equal(layers['dashboard-kiosk'], '9990');
  assert.equal(layers['presentation-cursor'], '9997');
  assert.equal(layers['presentation-dimmer'], '9998');
  assert.equal(layers['presentation-controls'], '9999');
  assert.ok(Number(layers['dashboard-kiosk']) < Number(layers['presentation-cursor']));
  assert.ok(Number(layers['presentation-cursor']) < Number(layers['presentation-dimmer']));
  assert.ok(Number(layers['presentation-dimmer']) < Number(layers['presentation-controls']));
  assert.match(dashboardSource, /isKiosk && createPortal\([\s\S]*?document\.body,/);
});

test('all inherited layer and grid keys retain their exact values', () => {
  const inheritedLayers = {
    overlay: '60', 'shell-status-bar': '55', 'shell-panel': '80', 'map-control': '1000',
    'presentation-controls': '9999', 'presentation-dimmer': '9998', 'presentation-cursor': '9997',
    'map-tile-control': '800', 'command-palette-backdrop': '200', 'command-palette-positioner': '201',
  };
  const inheritedGrids = {
    'metric-compact': 'minmax(0,1fr) minmax(0,1fr) 5rem',
    'replay-shortcuts': 'auto 1fr',
    'page-actions-scope': 'minmax(0,1fr) auto',
    'workspace-header': 'minmax(0,1fr) minmax(18rem,22rem) minmax(0,1fr)',
  };
  for (const [key, value] of Object.entries(inheritedLayers)) assert.equal(config.theme.extend.zIndex[key], value);
  for (const [key, value] of Object.entries(inheritedGrids)) assert.equal(config.theme.extend.gridTemplateColumns[key], value);
});

test('existing default and extended breakpoints remain unchanged', () => {
  assert.deepEqual(config.theme.extend.screens, { '3xl': '1920px' });
  assert.deepEqual(resolved.theme.screens, {
    sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px', '3xl': '1920px',
  });
});
