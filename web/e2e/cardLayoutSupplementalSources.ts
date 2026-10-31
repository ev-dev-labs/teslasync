import type { ChatMessage, ChatSessionInfo, TripDetail } from '../src/api/types';
import type { TimeMachineRange, TimeMachineState } from '../src/api/hooks/useTimeMachine';
import type { useTeslaUserRegion } from '../src/api/hooks/useUser';
import { causal, survival, storm, stormEvents } from '../src/features/advanced-intelligence/pages/advancedIntelligenceClosure.fixtures';
import { split, park, passport } from './operationalbrief-contracts/battery.fixtures';
import { accountSessions, fleetApiInfo, publicKey } from './operationalbrief-contracts/settings.fixtures';
import { ACTION_CENTER } from './operationalbrief-contracts/actions.fixtures';
import { tripDetail, journeyDetail } from './operationalbrief-contracts/trips.fixtures';
import { billVariance } from './operationalbrief-contracts/charging.fixtures';
import { mockDrive } from './mockApi';
import { electrochemFixture, thermalFixture, weatherFixture, tiresFixture, notebookFixture } from './operationalbrief-contracts/science.fixtures';
import { catalogueOperationalSources } from './dashboardCatalogueOperationalSources';
import { catalogueSystemSources } from './dashboardCatalogueSystemSources';

const now = '2026-08-26T16:00:00.000Z';
const earlier = '2026-08-25T16:00:00.000Z';
const sessionId = '00000000-0000-4000-8000-000000000701';
const sessions = [{
  id: sessionId, title: 'Synthetic telemetry review', first_message: 'Review recorded telemetry.',
  message_count: 1, last_message_at: now, created_at: earlier,
}] satisfies ChatSessionInfo[];
const messages = [{
  id: 1, session_id: sessionId, role: 'assistant',
  content: 'Synthetic recorded telemetry is available for review.', created_at: now,
}] satisfies ChatMessage[];
const region = {
  data: { region: 'North America', fleet_api_base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com' },
  fetched_at: now,
} satisfies NonNullable<ReturnType<typeof useTeslaUserRegion>['data']>;
const bounds = { earliest: earlier, latest: now, field_count: 1 } satisfies TimeMachineRange;
const operational = catalogueOperationalSources(now);
const system = catalogueSystemSources(now);
const sources: Record<string, unknown> = {
  '/physics/park-truth': park,
  '/physics/vampire': split,
  '/vehicles/7/battery-passport': passport,
  '/auth/sessions': accountSessions,
  '/stormguard/status': storm,
  '/stormguard/events': stormEvents,
  '/tire-pressure': operational['/tire-pressure'],
  '/tire-pressure/latest': operational['/tire-pressure/latest'],
  '/vehicles/7/commands/history': operational['/vehicles/7/commands/history'],
  '/vehicles/7/commands/latest': operational['/vehicles/7/commands/history'],
  '/media/latest': operational['/media/latest'],
  '/media': operational['/media'],
  '/locations': operational['/locations'],
  '/location-snapshots/latest': operational['/location-snapshots/latest'],
  '/vehicles/7/positions': operational['/vehicles/7/positions'],
  '/charge-autopilot/decision': operational['/charge-autopilot/decision'],
  '/backup/runs': system['/backup/runs'],
  '/dev-tools/fleet-api-info': fleetApiInfo,
  '/dev-tools/public-key-status': publicKey,
  '/journey/sessions/701': journeyDetail,
  '/drives/101': mockDrive,
  '/charging/bill-variance': billVariance,
  '/trips/1': { ...tripDetail, id: 1 } satisfies TripDetail,
  '/science/electrochem': electrochemFixture,
  '/science/thermal': thermalFixture,
  '/science/weather': weatherFixture,
  '/science/tires': tiresFixture,
  '/science/notebook': notebookFixture,
  '/chatbot/sessions': sessions,
  '/tesla/user/region': region,
  '/vehicles/7/time-machine/range': bounds,
};
if (Object.values(sources).some(value => value === undefined)) {
  throw new Error('A reviewed card-layout supplemental source is missing');
}

export const cardLayoutSupplementalPaths = [
  ...Object.keys(sources), '/action-center', '/chatbot/history', '/vehicles/7/time-machine',
  '/advanced-intelligence/causal-experiments', '/advanced-intelligence/component-survival',
];

export function resolveCardLayoutSupplementalSource(url: URL): unknown | undefined {
  const pathname = url.pathname.replace(/^\/api\/v1/, '');
  if (Object.hasOwn(sources, pathname)) return sources[pathname];
  if (pathname === '/chatbot/history') {
    return url.searchParams.get('session_id') === sessionId ? messages : undefined;
  }
  if (pathname === '/vehicles/7/time-machine') {
    const at = url.searchParams.get('at');
    if (!at || !Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(earlier)) return undefined;
    return {
      at, count: 1, fields: [{
        field: 'BatteryLevel', value: 70, value_kind: 'float', ts: earlier,
        age_seconds: (Date.parse(at) - Date.parse(earlier)) / 1000,
      }],
    } satisfies TimeMachineState;
  }
  const limit = Number(url.searchParams.get('limit') ?? 25);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return undefined;
  if (pathname === '/action-center') {
    return { ...ACTION_CENTER, limit, offset, items: ACTION_CENTER.items.slice(offset, offset + limit) };
  }
  if (pathname === '/advanced-intelligence/causal-experiments') {
    return { items: offset === 0 ? [causal] : [], total: 1, limit, offset };
  }
  if (pathname === '/advanced-intelligence/component-survival') {
    return { items: offset === 0 ? [survival] : [], total: 1, limit, offset };
  }
  return undefined;
}
