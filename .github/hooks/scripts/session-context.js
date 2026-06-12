#!/usr/bin/env node
/*
 * Copilot CLI / cloud-agent `sessionStart` context injector.
 *
 * Prepends a short, high-signal reminder of the conventions that agents most
 * often violate in this repo, plus pointers to the canonical guideline docs.
 * Returned as `additionalContext`, which is injected into the session.
 *
 * Output schema: { additionalContext?: string }
 */

'use strict';

const CONTEXT = [
  'TeslaSync working agreement (key reminders — full rules in .github/copilot-instructions.md):',
  '• Backend writes SI units on disk/in APIs (m, m/s, °C, Pa, Wh). Phase-48 forbids NEW unit-suffixed fields/columns (_mi/_min/_mph/_kwh/_kw/_psi → use _m/_s/_mps/_wh/_w/_kpa). Convert only at the React render boundary via useUnits().',
  '• Frontend: no inline static CSS-var styles, no raw <button>/<input>/<table> (use @/components/ui), no direct recharts/react-leaflet/framer-motion imports, no `../api` imports (use @/api/hooks).',
  '• API hooks must NOT include the /api/v1 prefix (the client adds it) and must use snake_case query params (vehicle_id, not vehicleId).',
  '• Always show sections with an EmptyState when data is null — never hide them. Wrap user strings in t() for i18n.',
  '• Never run `git push` directly — use the report_progress tool. Never read .github/agents.',
  '• Verify before claiming done: `cd web && npx tsc --noEmit`, then the audit-violations skill.',
].join('\n');

try {
  process.stdout.write(JSON.stringify({ additionalContext: CONTEXT }));
} catch (_e) {
  process.stdout.write('{}');
}
process.exit(0);
