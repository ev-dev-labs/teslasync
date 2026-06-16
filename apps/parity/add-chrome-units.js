// One-shot helper: define the shell/theme/layout "chrome" parity units that the manifest
// scan never captured (the nav sidebar, theme application, status bar, top toolbar, dashboard
// layout system, digital twin) and merge honest live-visual rows into windows-ledger.json.
// Scores/deltas are recorded from real screenshot comparison vs http://localhost:3000.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const SHOTS = 'apps/windows/.loop-logs/shots';

const units = [
  {
    unitId: 'component:shell/Sidebar',
    title: 'Navigation sidebar',
    parityChecklist: [
      'Favorites section above the groups',
      'Collapsible route groups with item-count badges',
      'Groups collapsed by default',
      'Colour-coded group icons',
      'Logo + product name at top',
      'Search affordance',
    ],
    status: 'todo',
    visualScore: 88,
    shotPath: `${SHOTS}/component-shell-Sidebar.png`,
    deltas: [
      'group taxonomy uses the native 17 RouteGroups, not the web sidebar 19 groups (HOME/VEHICLES/DRIVING/…)',
      'search lives in the title bar rather than inside the sidebar (platform difference)',
    ],
    evidenceLog: 'live screenshot win-sidebar-light.png vs web-dash-real.png',
  },
  {
    unitId: 'component:theme/BackendSync',
    title: 'Theme application (accent + colour mode)',
    parityChecklist: [
      'Accent theme + colour mode seeded from backend /settings at startup',
      'Light/card-based look when the account is light mode',
      'Token brushes recolour app-wide on theme change',
      'Local default only stands in until backend resolves',
    ],
    status: 'todo',
    visualScore: 92,
    shotPath: `${SHOTS}/component-theme-BackendSync.png`,
    deltas: [
      'solar-amber light surface reads slightly warmer/cream vs the web near-white',
    ],
    evidenceLog: 'live screenshot win-dash-imperial.png (light + solar-amber) vs web-dash-real.png',
  },
  {
    unitId: 'component:dashboard/Banners',
    title: 'Dashboard banners (web parity = none)',
    parityChecklist: [
      'No native-only "Personalize TeslaSync" first-run banner',
      'No "Tesla account not connected" warning banner',
      'No broken dark-on-light chrome',
    ],
    status: 'done',
    visualScore: 95,
    shotPath: `${SHOTS}/component-dashboard-Banners.png`,
    deltas: [],
    evidenceLog: 'live screenshot win-dash-nobanners2.png vs web-dash-real.png (web shows neither banner)',
  },
  {
    unitId: 'component:units/BackendSync',
    title: 'Unit preference (metric/imperial) from backend',
    parityChecklist: [
      'Unit preference seeded from backend /settings',
      'Distance/speed/temp render in the account units (mi/mph/°F when imperial)',
      'List pages and dashboard widgets both honour the preference',
    ],
    status: 'done',
    visualScore: 95,
    shotPath: `${SHOTS}/component-units-BackendSync.png`,
    deltas: [],
    evidenceLog: 'live screenshot win-dash-imperial.png (mi / °F / Wh·mi) vs web-dash-real.png',
  },
  {
    unitId: 'component:shell/TopToolbar',
    title: 'Top toolbar (refresh/export/kiosk/customize/live/print)',
    parityChecklist: [
      'Refresh, export, kiosk, customize, notifications, live indicator, print actions',
      'Right-aligned in the header row',
    ],
    status: 'todo',
    visualScore: 0,
    shotPath: '',
    deltas: ['native header has a minimal action set vs the web toolbar cluster'],
    evidenceLog: '',
  },
  {
    unitId: 'component:shell/StatusBar',
    title: 'Bottom status bar',
    parityChecklist: [
      'API latency + live indicator on the left',
      'Active vehicle name / SoC / range on the right',
      'Shortcuts, tour, report-bug, version links',
    ],
    status: 'todo',
    visualScore: 0,
    shotPath: '',
    deltas: ['native status bar shows only a "Secured" hint vs the web rich status bar'],
    evidenceLog: '',
  },
  {
    unitId: 'component:dashboard/LayoutSystem',
    title: 'Customizable dashboard widget grid',
    parityChecklist: [
      'GET STARTED onboarding checklist',
      'Recently Viewed strip',
      'Layout picker (Default / New Layout / Save as / Edit)',
      'Add-widget floating action + persistence',
    ],
    status: 'todo',
    visualScore: 0,
    shotPath: '',
    deltas: ['native dashboard is a fixed curated widget set; the web customizable layout grid is not ported'],
    evidenceLog: '',
  },
  {
    unitId: 'component:data-display/DigitalTwin3D',
    title: 'Digital twin vehicle render',
    parityChecklist: [
      'Vehicle render with live lock/sentry/charging/closure state',
      'Matches the web digital twin fidelity',
    ],
    status: 'todo',
    visualScore: 70,
    shotPath: `${SHOTS}/component-data-display-DigitalTwin3D.png`,
    deltas: ['native renders a 2D vehicle illustration; web renders a higher-fidelity twin'],
    evidenceLog: 'live screenshot win-dash-nobanners2.png',
  },
];

// 1) write the spec file (combined-list partner of parity-manifest.json)
const specPath = path.join(dir, 'parity-chrome-units.json');
const spec = units.map(({ status, visualScore, shotPath, deltas, evidenceLog, ...rest }) => rest);
fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
console.log('wrote', path.relative(dir, specPath), '(' + spec.length + ' units)');

// 2) merge honest rows into the ledger
const ledgerPath = path.join(dir, 'windows-ledger.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const byId = new Map(ledger.map((r) => [r.unitId, r]));
for (const u of units) {
  const row = {
    unitId: u.unitId,
    platform: 'windows',
    status: u.status,
    coveredCount: u.parityChecklist.length - u.deltas.length,
    requiredCount: u.parityChecklist.length,
    visualScore: u.visualScore,
    shotPath: u.shotPath,
    deltas: u.deltas,
    attempts: 1,
    promptId: 'live-visual/windows-parity-loop',
    evidenceLog: u.evidenceLog,
  };
  byId.set(u.unitId, row);
}
const merged = Array.from(byId.values());
fs.writeFileSync(ledgerPath, JSON.stringify(merged, null, 2) + '\n');
const done = merged.filter((r) => r.status === 'done').length;
const blocked = merged.filter((r) => r.status === 'blocked').length;
const todo = merged.filter((r) => r.status === 'todo' || r.status === 'in_progress').length;
console.log(`ledger rows: ${merged.length} (done ${done}, blocked ${blocked}, todo ${todo})`);
