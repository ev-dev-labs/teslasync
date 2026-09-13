/**
 * Generates docs/features/catalogue*.md from the live SPA sidebar + Explore blurbs.
 * Run from repo root: node docs/scripts/generate-feature-catalogue.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const layoutPath = path.join(root, 'web/src/components/layout/Layout.tsx');
const catalogPath = path.join(root, 'web/src/features/explore/featureCatalog.ts');
const outDir = path.join(root, 'docs/features');

const EXTRA_PANELS = {
  Charging: [
    {
      label: 'Wait Oracle',
      to: '/tesla-charging-history',
      description:
        'Embedded panel: Supercharger wait forecast (Erlang-C on your site history). Not Tesla live occupancy.',
      empty: 'Empty until Supercharger sessions exist for that site name.',
    },
  ],
  Driving: [
    {
      label: 'Drive detail',
      to: '/drives/:id',
      description: 'Route, energy, FSD share, cost, and session telemetry for one drive.',
      empty: 'Open a row from /drives. FSD % needs trip-meter ticks; quantized 1-mile Tesla counters are valid.',
    },
  ],
  Automation: [
    {
      label: 'Comfort calendar',
      to: '/automations',
      description: 'ICS-driven climate windows (Comfort panel on Automations).',
      empty: 'Needs a reachable https ICS URL; loopback and metadata hosts are blocked.',
    },
  ],
  'Advanced Intelligence': [
    {
      label: 'Storm Guardian',
      to: '/intelligence/emergency-resilience',
      description: 'Weather-aware energy / charging caution from local storm data.',
      empty: 'Needs location history and weather provider configuration.',
    },
  ],
};

function parseDescriptions(src) {
  const map = {};
  const re = /'([^']+)':\s*'((?:\\'|[^'])*)'/g;
  const block = src.slice(src.indexOf('const DESCRIPTIONS'), src.indexOf('export function buildFeatureCatalog'));
  let m;
  while ((m = re.exec(block))) {
    map[m[1]] = m[2].replace(/\\'/g, "'");
  }
  return map;
}

function parseNav(src) {
  const start = src.indexOf('export const navSections');
  const end = src.indexOf('type NavSection');
  const block = src.slice(start, end);
  const sections = [];
  const titleRe = /title:\s*'([^']+)'/g;
  let tm;
  const titles = [];
  while ((tm = titleRe.exec(block))) titles.push({ title: tm[1], idx: tm.index });
  for (let i = 0; i < titles.length; i++) {
    const chunk = block.slice(titles[i].idx, titles[i + 1]?.idx ?? block.length);
    const items = [];
    const itemRe = /to:\s*'([^']+)'[\s\S]*?label:\s*'([^']+)'/g;
    let im;
    while ((im = itemRe.exec(chunk))) items.push({ to: im[1], label: im[2] });
    sections.push({ title: titles[i].title, items });
  }
  return sections;
}

function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function emptyHint(to, description) {
  if (/admin|mqtt|redis|dlq|debug/i.test(to)) return 'Operator surface — needs a healthy API, MQTT, and DB.';
  if (/tesla-account|fleet-setup|fleet-api/i.test(to)) return 'Empty until Tesla Fleet API is connected in Settings → Fleet Setup.';
  if (/charging|battery|drive|energy|fsd/i.test(to)) return 'Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions.';
  if (/helix|chatbot/i.test(to)) return 'Hidden until Helix is enabled in Settings.';
  return description.includes('Never') ? 'Shows unknown/empty honestly when signals are missing.' : 'Renders an empty state when no data is available — the page is not hidden.';
}

const layout = fs.readFileSync(layoutPath, 'utf8');
const catalogSrc = fs.readFileSync(catalogPath, 'utf8');
const descriptions = parseDescriptions(catalogSrc);
const sections = parseNav(layout);

const indexRows = sections.map((s) => {
  const sl = slug(s.title);
  return `| ${s.title} | ${s.items.length} | [catalogue-${sl}.md](./catalogue-${sl}.md) |`;
});

const index = `# Feature catalogue

Operator index of TeslaSync screens. Labels and paths come from the live sidebar (\`navSections\` in \`web/src/components/layout/Layout.tsx\`). One-line descriptions come from Explore (\`web/src/features/explore/featureCatalog.ts\`).

**In the app:** sidebar groups, or **Explore Features** at \`/explore\`.

| Sidebar group | Screens | Catalogue page |
| ------------- | ------: | -------------- |
${indexRows.join('\n')}

## How to use this

1. Find the **sidebar group** (same titles as the app).
2. Open the path in your installation (example: \`https://your-host/charging\`).
3. If a panel is empty, use the **When empty** column — missing telemetry is not a blank product.

Detail pages such as \`/drives/:id\` and \`/charging/:id\` are opened from list rows, not the sidebar.

Regenerate after nav changes:

\`\`\`bash
node docs/scripts/generate-feature-catalogue.mjs
\`\`\`
`;

fs.writeFileSync(path.join(outDir, 'catalogue.md'), index);

for (const section of sections) {
  const sl = slug(section.title);
  const extras = EXTRA_PANELS[section.title] ?? [];
  const rows = [
    ...section.items.map((it) => {
      const desc = descriptions[it.to] ?? `Open ${it.label}.`;
      return `| ${escapeCell(it.label)} | \`${it.to}\` | ${escapeCell(desc)} | ${escapeCell(emptyHint(it.to, desc))} |`;
    }),
    ...extras.map(
      (p) =>
        `| ${escapeCell(p.label)} | \`${p.to}\` | ${escapeCell(p.description)} | ${escapeCell(p.empty)} |`,
    ),
  ];
  const md = `# ${section.title}

Sidebar group **${section.title}**. In the app, expand this section in the left nav (or search \`/explore\`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
${rows.join('\n')}

[← All groups](./catalogue.md)
`;
  fs.writeFileSync(path.join(outDir, `catalogue-${sl}.md`), md);
}

console.log(
  'Wrote catalogue.md + ' +
    sections.length +
    ' group pages (' +
    sections.reduce((n, s) => n + s.items.length, 0) +
    ' screens)',
);
