#!/usr/bin/env node
/*
 * Copilot CLI / cloud-agent `postToolUse` guidelines audit.
 *
 * After an `edit`/`create` tool finishes, re-read the touched file and scan it
 * for the prohibited patterns listed in .github/copilot-instructions.md. Any
 * findings are returned as `additionalContext` so the agent sees them on the
 * same turn and can self-correct. This hook is advisory only — it never blocks
 * and never fails the tool result.
 *
 * Output schema: { additionalContext?: string }
 * (https://docs.github.com/en/copilot/reference/hooks-reference)
 */

'use strict';

const fs = require('fs');

function emit(context) {
  if (context) {
    process.stdout.write(JSON.stringify({ additionalContext: context }));
  } else {
    process.stdout.write('{}');
  }
  process.exit(0);
}

function getFilePath(args) {
  if (!args || typeof args !== 'object') return null;
  const keys = ['path', 'file', 'filePath', 'file_path', 'absolutePath', 'absolute_path'];
  for (const k of keys) {
    if (typeof args[k] === 'string' && args[k].length > 0) return args[k];
  }
  return null;
}

// A check: { re: RegExp, msg: string }. `re` runs per-line; first hit per check
// is reported with its line number.
const WEB_CHECKS = [
  {
    re: /style=\{\{[^}]*var\(--/,
    // Allow dynamic values (ternaries, array/index lookups) — only static
    // var(--*) inline styles are prohibited (see instructions exception).
    skipIf: (l) => /[?\[]/.test(l),
    msg: 'Inline style with a static CSS var — use a Tailwind/className token instead (prohibited pattern #1).',
  },
  {
    re: /from\s+['"](recharts|react-leaflet|framer-motion)['"]/,
    msg: 'Direct chart/map/motion library import — import from @/components/charts, @/components/maps, or @/components/motion (prohibited pattern #3).',
  },
  {
    re: /from\s+['"]\.\.?\/(\.\.\/)*api['"]/,
    msg: 'Old relative `../api` import — use the TanStack Query hooks under @/api/hooks (prohibited pattern #4).',
  },
  {
    re: /dangerouslySetInnerHTML/,
    msg: 'dangerouslySetInnerHTML is an XSS risk and is banned — let React escape content.',
  },
];

const HOOK_CHECKS = [
  {
    re: /['"`]\/api\/v1\//,
    msg: 'Double `/api/v1/` prefix in a hook URL — the request() client already adds it (prohibited pattern #7).',
  },
  {
    re: /(vehicleId|driveId|sessionId|chargingId)=/,
    msg: 'camelCase query parameter — the backend expects snake_case (e.g. vehicle_id) (prohibited pattern #8).',
  },
];

// Phase-48 SI canonical: no new unit-suffixed Go fields / JSON columns.
const GO_CHECKS = [
  {
    re: /`json:"[a-z0-9_]*_(mi|min|mph|kwh|kw|psi)"/i,
    msg: 'Legacy unit-suffixed JSON tag — Phase-48 requires SI canonical names (_m, _s, _mps, _wh, _w, _kpa). See the SI migration methodology.',
  },
  {
    // Anchored to a struct-field declaration line: leading indentation, an
    // exported (capitalised) field name ending in a legacy unit suffix, then a
    // numeric Go type. This avoids flagging unrelated identifiers like a local
    // `maximumMi` variable that merely ends in one of these suffixes.
    re: /^\s+[A-Z]\w*(Mi|Min|Mph|Kwh|Kw|Psi)\s+\*?(float64|float32|int64|int32|int|uint64)\b/,
    msg: 'Legacy unit-suffixed Go struct field — Phase-48 requires SI canonical names (M, S, Mps, Wh, W, Kpa).',
  },
];

function checksFor(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const checks = [];
  const isWeb = /(^|\/)web\/src\//.test(p);
  const isComponentLib = /(^|\/)web\/src\/components\//.test(p);
  if (isWeb && /\.(ts|tsx)$/.test(p)) {
    // The shared component library legitimately wraps the raw libraries.
    if (!isComponentLib) checks.push(...WEB_CHECKS);
    if (/(^|\/)web\/src\/api\/hooks\//.test(p)) checks.push(...HOOK_CHECKS);
  }
  if (/\.go$/.test(p)) checks.push(...GO_CHECKS);
  return checks;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch (_e) {
    return emit(null);
  }

  const toolName = payload.toolName || payload.tool_name || '';
  if (!/^(edit|create)$/i.test(toolName)) return emit(null);

  const filePath = getFilePath(payload.toolArgs ?? payload.tool_input);
  if (!filePath) return emit(null);

  const checks = checksFor(filePath);
  if (checks.length === 0) return emit(null);

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return emit(null);
  }

  const lines = content.split(/\r?\n/);
  const findings = [];
  for (const check of checks) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (check.skipIf && check.skipIf(line)) continue;
      if (check.re.test(line)) {
        findings.push(`  - L${i + 1}: ${check.msg}`);
        break; // one report per check keeps the message focused
      }
    }
  }

  if (findings.length === 0) return emit(null);

  const header =
    `⚠️ TeslaSync guideline check flagged ${findings.length} possible issue(s) in ${filePath}:`;
  const footer =
    'Please fix these before continuing. See .github/copilot-instructions.md for the full rules.';
  return emit([header, ...findings, footer].join('\n'));
}

try {
  main();
} catch (_e) {
  emit(null);
}
