import { expect, type Page } from '@playwright/test'
import type { ActiveSessionsResponse, AppSettings, TOTPStatus, VersionInfo } from '../../src/api/types'
import type { AiUsageByFeatureResponse, AiUsageRecentResponse, AiUsageToday } from '../../src/api/hooks/useAiUsage'
import type { FleetApiInfo, PublicKeyStatus } from '../../src/api/hooks/useFleetSetup'
import type { OnboardingStatus } from '../../src/api/hooks/useOnboarding'
import { CONSENT_STORAGE_KEY } from '../../src/lib/cookieConsent'
import { RECENT_PAGES_STORAGE_KEY, type RecentEntry } from '../../src/lib/recentPages'
import { fulfillApiFixture, installApiMocks, mockAppSettings, seedBrowserState } from '../mockApi'

export type SettingsTheme = 'dark' | 'light'
export type SettingsWire = Omit<AppSettings, 'base_cost_per_kwh'> & { base_cost_per_kwh?: number | null }

export function savedSettings(theme: SettingsTheme, overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...mockAppSettings,
    mode: theme,
    tz_display_default: 'utc',
    ui_density: 'comfortable',
    time_format_default: 'absolute',
    chart_palette: 'cb_safe',
    ...overrides,
  }
}

export const usageToday: AiUsageToday = {
  user_subject: 'synthetic-settings-operator',
  call_count: 3,
  input_tokens: 1250,
  output_tokens: 420,
  cost_micro_cents: 1200,
  error_count: 1,
  avg_latency_ms: 35,
}

export const zeroUsage: AiUsageToday = {
  ...usageToday,
  call_count: 0,
  input_tokens: 0,
  output_tokens: 0,
  cost_micro_cents: 0,
  error_count: 0,
  avg_latency_ms: 0,
}

export const accountSessions: ActiveSessionsResponse = {
  mode: 'session',
  sessions: [
    {
      id: 'synthetic-current-session',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
      ip: '192.0.2.10',
      created_at: '2026-10-06T10:00:00Z',
      last_seen_at: '2026-10-06T23:00:00Z',
      current: true,
    },
    {
      id: 'synthetic-other-session',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/130.0',
      ip: '198.51.100.20',
      created_at: '2026-10-05T10:00:00Z',
      last_seen_at: '2026-10-06T22:00:00Z',
      current: false,
    },
  ],
}

export const protectedCredential: TOTPStatus = {
  mode: 'session',
  activated: true,
  backup_codes_remaining: 0,
}

export const deploymentVersion: VersionInfo = {
  app_version: 'synthetic-e2e',
  chart_version: 'synthetic-e2e',
  go_version: 'go1.25',
  os: 'linux',
  arch: 'amd64',
  uptime_seconds: 3600,
  goroutines: 12,
  require_cookie_consent: false,
}

export const fleetApiInfo: FleetApiInfo = {
  base_url: 'https://fleet.example.invalid',
  client_id: 'synthetic-client-id',
  has_valid_token: true,
  public_key_url: 'https://fleet.example.invalid/.well-known/appspecific/com.tesla.3p.public-key.pem',
  hostname: 'fleet.example.invalid',
}

export const publicKey: PublicKeyStatus = {
  configured: true,
  fingerprint: 'SYNTHETIC:PUBLIC:KEY:00:11:22:33',
  well_known_path: '/.well-known/appspecific/com.tesla.3p.public-key.pem',
  created_at: '2026-10-06T10:00:00Z',
}

export const completeOnboarding: OnboardingStatus = {
  tesla_connected: true,
  vehicle_count: 1,
  data_flowing: true,
  last_telemetry_at: '2026-10-06T23:00:00Z',
  telemetry_health: 'healthy',
  setup_required: false,
  setup_complete: true,
  is_complete: true,
}

interface FixtureOptions {
  settings?: SettingsWire
  sessions?: ActiveSessionsResponse
  totp?: TOTPStatus | Omit<Extract<TOTPStatus, { mode: 'session' }>, 'backup_codes_remaining'>
  version?: VersionInfo
  fleet?: boolean
  publicKey?: PublicKeyStatus
  token?: FleetApiInfo
  usage?: AiUsageToday
  usageState?: 'available' | 'unavailable'
  settingsState?: 'available' | 'unavailable'
  sessionsState?: 'available' | 'unavailable' | 'open'
  publicKeyState?: 'available' | 'unavailable'
  holdPublicKey?: boolean
}

export async function installSettingsFixtures(
  page: Page,
  theme: SettingsTheme,
  path: string,
  options: FixtureOptions = {},
) {
  await seedBrowserState(page, theme, path)
  if (path === '/account/privacy') {
    const recent: RecentEntry[] = [
      { path: '/settings', title: 'Settings', kind: 'page', visited_at: Date.parse('2026-10-06T22:00:00Z') },
      { path: '/settings/safety', title: 'Safety settings', kind: 'page', visited_at: Date.parse('2026-10-06T22:01:00Z') },
    ]
    await page.addInitScript(({ consentKey, recentKey, entries }) => {
      localStorage.setItem(consentKey, 'accepted')
      localStorage.setItem(recentKey, JSON.stringify(entries))
    }, { consentKey: CONSENT_STORAGE_KEY, recentKey: RECENT_PAGES_STORAGE_KEY, entries: recent })
  }
  const api = await installApiMocks(page, 'populated', theme)
  if (!api) throw new Error('Settings OperationalBrief contracts require the strict mocked API harness')
  const state = {
    usage: options.usage ?? usageToday,
    usageState: options.usageState ?? 'available',
    settingsState: options.settingsState ?? 'available',
    sessionsState: options.sessionsState ?? 'available',
    publicKeyState: options.publicKeyState ?? 'available',
  }
  const json = async (endpoint: string, body: () => unknown, status: () => number = () => 200) => {
    await page.route(url => url.pathname === `/api/v1${endpoint}` && !url.search, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      await fulfillApiFixture(route, api, {
        status: status(),
        contentType: 'application/json',
        body: JSON.stringify(body()),
      })
    })
  }
  await json('/settings', () => state.settingsState === 'unavailable'
    ? { error: 'Synthetic settings source unavailable' } : options.settings ?? savedSettings(theme),
  () => state.settingsState === 'unavailable' ? 503 : 200)
  await json('/onboarding/status', () => completeOnboarding)
  await json('/system/version', () => options.version ?? deploymentVersion)
  await json('/auth/sessions', () => state.sessionsState === 'open'
    ? { error: 'Synthetic open-mode fixture', code: 'AUTH_MODE_OPEN' }
    : state.sessionsState === 'unavailable'
      ? { error: 'Synthetic session source unavailable' }
      : options.sessions ?? accountSessions,
  () => state.sessionsState === 'open' ? 501 : state.sessionsState === 'unavailable' ? 503 : 200)
  await json('/auth/totp', () => options.totp ?? protectedCredential)
  await json('/ai/usage/today', () => state.usageState === 'unavailable'
    ? { error: 'Synthetic daily audit unavailable' } : state.usage,
  () => state.usageState === 'unavailable' ? 503 : 200)
  const featureUsage: AiUsageByFeatureResponse = { since: '2026-09-29T00:00:00Z', rows: [] }
  const recentUsage: AiUsageRecentResponse = { limit: 50, rows: [] }
  await json('/ai/usage/by-feature', () => featureUsage)
  await page.route(url => url.pathname === '/api/v1/ai/usage/recent' && url.search === '?limit=50', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await fulfillApiFixture(route, api, {
      status: 200, contentType: 'application/json', body: JSON.stringify(recentUsage),
    })
  })
  let releasePublicKey: () => void = () => undefined
  const publicKeyReady = options.holdPublicKey
    ? new Promise<void>(resolve => { releasePublicKey = resolve })
    : Promise.resolve()
  if (options.fleet) {
    await json('/auth/status', () => ({ authenticated: true }))
    await json('/dev-tools/fleet-api-info', () => options.token ?? fleetApiInfo)
    await page.route(url => url.pathname === '/api/v1/dev-tools/public-key-status' && !url.search, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      await publicKeyReady
      await fulfillApiFixture(route, api, {
        status: state.publicKeyState === 'unavailable' ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(state.publicKeyState === 'unavailable'
          ? { error: 'Synthetic domain source unavailable' } : options.publicKey ?? publicKey),
      })
    })
  }
  return { api, state, releasePublicKey }
}

export function expectSettingsReadOnly(api: NonNullable<Awaited<ReturnType<typeof installApiMocks>>>) {
  const mutations = api.requests.filter(request => request.method !== 'GET'
    && !['/api/v1/web-vitals', '/api/v1/web-errors'].includes(request.path))
  expect(mutations, 'Review, local edits and category selection must not save or invoke providers').toEqual([])
}
