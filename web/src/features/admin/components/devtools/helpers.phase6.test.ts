import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, MutationObserver } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import { formatDateTime, formatRelative } from '@/lib/dateFormat'
import { fmtInt, getGlobalLocale, setGlobalLocale } from '@/lib/numberFormat'
import { assertOperationalWriteAllowed, OperationalModeWriteError } from '@/lib/operationalMode'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18n.t }),
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'de-DE', tz: 'Europe/Berlin' },
    locale: 'de-DE',
    formatDateTime: (date: Date) =>
      formatDateTime(date, { locale: 'de-DE', tz: 'Europe/Berlin' }),
  }),
}))
vi.mock('./ToolCard', () => ({
  ToolCard: ({ children }: { children: ReactNode }) => createElement('section', null, children),
}))
vi.mock('@/components/ui', () => ({
  Input: ({ label, icon: _icon, ...props }: {
    label: string
    icon?: ReactNode
    value: string
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  }) => createElement('label', null, label, createElement('input', props)),
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) =>
    createElement('button', { onClick }, children),
  Badge: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}))

import { request, SudoCanceledError } from '@/api/client'
import { apiFetch, describeCron, getNextCronRuns, getRelativeTime, isValidCron } from './helpers'
import { CronParserTool } from './tools/CronParser'
import { TimestampTool } from './tools/TimestampTool'

const requestMock = vi.mocked(request)
const originalLocale = getGlobalLocale()
const originalUrl = window.location.href
const fields = (expression: string) => expression.split(' ')

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
})
beforeEach(() => {
  requestMock.mockReset()
  setGlobalLocale('en-US')
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2024, 2, 15, 12, 0, 30))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setGlobalLocale(originalLocale)
  window.history.replaceState(null, '', originalUrl)
})

describe('phase6 helper request contract', () => {
  it('preserves successful response identity and request payloads', async () => {
    const payload = { response: { errors: [] }, zero: 0 }
    requestMock.mockResolvedValue(payload)
    expect(await apiFetch('fleet-api-info')).toBe(payload)
    expect(requestMock).toHaveBeenLastCalledWith('/dev-tools/fleet-api-info', { method: 'GET' })
    await apiFetch('upload-public-key', 'POST', { public_key_pem: 'synthetic-public-key' })
    expect(requestMock).toHaveBeenLastCalledWith('/dev-tools/upload-public-key', {
      method: 'POST', requiresLiveMode: true,
      body: '{"public_key_pem":"synthetic-public-key"}',
    })
    await apiFetch('mqtt-test', 'POST', false)
    expect(requestMock).toHaveBeenLastCalledWith('/dev-tools/mqtt-test', {
      method: 'POST', requiresLiveMode: true, body: 'false',
    })
  })

  it.each([
    new Error('synthetic upstream failure'),
    new SudoCanceledError(),
    new DOMException('cancelled', 'AbortError'),
    'synthetic non-Error rejection',
  ])('propagates the original rejected value, including cancellation: %s', async error => {
    requestMock.mockRejectedValue(error)
    await expect(apiFetch('generate-keypair', 'POST')).rejects.toBe(error)
  })

  it('retains the last successful query payload after a rejected refresh', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const queryKey = ['devtools', 'public-key-status']
    const payload = { has_public_key: true }
    const failure = new Error('synthetic refresh failure')
    try {
      requestMock.mockResolvedValueOnce(payload)
      await client.fetchQuery({ queryKey, queryFn: () => apiFetch('public-key-status') })
      requestMock.mockRejectedValueOnce(failure)
      await expect(client.fetchQuery({ queryKey, queryFn: () => apiFetch('public-key-status') }))
        .rejects.toBe(failure)
      expect(client.getQueryData(queryKey)).toBe(payload)
      expect(client.getQueryState(queryKey)?.error).toBe(failure)
    } finally {
      client.clear()
    }
  })

  it('does not run mutation success lifecycle callbacks on failure or sudo cancellation', async () => {
    const client = new QueryClient()
    const onSuccess = vi.fn()
    const mutation = new MutationObserver(client, {
      networkMode: 'always',
      retry: false,
      mutationFn: () => apiFetch('upload-public-key', 'POST', { public_key_pem: 'synthetic' }),
      onSuccess,
    })
    try {
      for (const failure of [new Error('synthetic upload failure'), new SudoCanceledError()]) {
        requestMock.mockRejectedValueOnce(failure)
        await expect(mutation.mutate(undefined)).rejects.toBe(failure)
        expect(onSuccess).not.toHaveBeenCalled()
      }
    } finally {
      client.clear()
    }
  })

  it.each([
    ['register-partner', 'POST'],
    ['generate-keypair', 'POST'],
    ['upload-public-key', 'POST'],
    ['public-key', 'DELETE'],
    ['pair-vehicle-key', 'POST'],
    ['fleet-telemetry-subscribe', 'POST'],
    ['fleet-telemetry-config?vin=SYNTHETIC', 'DELETE'],
    ['mqtt-test', 'POST'],
  ] as const)('marks actual unsafe writes live-only: %s %s', async (endpoint, method) => {
    requestMock.mockResolvedValue({})
    await apiFetch(endpoint, method)
    expect(requestMock).toHaveBeenLastCalledWith(`/dev-tools/${endpoint}`, {
      method, requiresLiveMode: true,
    })
  })

  it('keeps the FleetStatus POST read and all GET requests outside the write guard', async () => {
    requestMock.mockResolvedValue({})
    await apiFetch('fleet-status', 'POST', { vins: ['SYNTHETIC'] })
    expect(requestMock).toHaveBeenLastCalledWith('/dev-tools/fleet-status', {
      method: 'POST', body: '{"vins":["SYNTHETIC"]}',
    })
    await apiFetch('public-key-status')
    expect(requestMock).toHaveBeenLastCalledWith('/dev-tools/public-key-status', { method: 'GET' })
  })

  it.each(['historical', 'offline'] as const)(
    'rejects before transport through the real client in %s mode', async mode => {
      const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
      requestMock.mockImplementation(actual.request)
      const transport = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected transport'))
      if (mode === 'historical') {
        window.history.replaceState(null, '', '?as_of=2024-01-01T00:00:00Z')
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
      } else {
        window.history.replaceState(null, '', window.location.pathname)
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      }
      await expect(apiFetch('generate-keypair', 'POST')).rejects.toBeInstanceOf(OperationalModeWriteError)
      await expect(apiFetch('fleet-telemetry-config?vin=SYNTHETIC', 'DELETE'))
        .rejects.toBeInstanceOf(OperationalModeWriteError)
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it('read-only POST remains permitted by the existing operational policy', () => {
    window.history.replaceState(null, '', '?as_of=2024-01-01T00:00:00Z')
    expect(() => assertOperationalWriteAllowed('POST', false)).not.toThrow()
  })
})

describe('phase6 cron grammar', () => {
  it.each([
    '* * * * *', '0 * * * *', '0 0 * * *', '0 0 * * 0', '0 0 1 * *',
    '*/5 * * * *', '10-20/5 * * * *', '10/5 * * * *',
    '1,10-20/5,*/30 * * * *', '59 23 31 12 6',
  ])('accepts existing presets and bounded numeric grammar: %s', expression => {
    expect(isValidCron(fields(expression))).toBe(true)
  })
  it.each([
    'a b c d e', '60 * * * *', '0 24 * * *', '0 0 0 * *',
    '0 0 32 * *', '0 0 * 0 *', '0 0 * 13 *', '0 0 * * 7',
    '*/0 * * * *', '*/-2 * * * *', '*/1.5 * * * *',
    '20-10/5 * * * *', '10-60/5 * * * *', '10-20/ * * * *',
    '10/5/2 * * * *', '0, * * * *', '5junk * * * *',
    '-1 * * * *', '1e1 * * * *', '* * * *', '* * * * * *',
  ])('rejects malformed fields without claiming no upcoming runs: %s', expression => {
    expect(isValidCron(fields(expression))).toBe(false)
    expect(getNextCronRuns(fields(expression), 5)).toEqual([])
    expect(describeCron(fields(expression))).toBe('Invalid cron expression')
  })
  it('anchors range steps at their base and never emits outside the range', () => {
    const runs = getNextCronRuns(fields('10-20/5 * * * *'), 5)
    expect(runs.map(date => date.getMinutes())).toEqual([10, 15, 20, 10, 15])
    expect(runs).toHaveLength(5)
  })
  it('extends a numeric slash base only through the field maximum', () => {
    expect(getNextCronRuns(fields('11/20 * * * *'), 5).map(date => date.getMinutes()))
      .toEqual([11, 31, 51, 11, 31])
  })
  it('preserves lists, plain ranges, and the five-run next-minute contract', () => {
    expect(getNextCronRuns(fields('0,30 * * * *'), 5).map(date => date.getMinutes()))
      .toEqual([30, 0, 30, 0, 30])
    expect(getNextCronRuns(fields('10-12 * * * *'), 5).map(date => date.getMinutes()))
      .toEqual([10, 11, 12, 10, 11])
    const everyMinute = getNextCronRuns(fields('* * * * *'), 5)
    expect(everyMinute).toHaveLength(5)
    expect(everyMinute[0]!.getTime()).toBe(new Date(2024, 2, 15, 12, 1).getTime())
    expect(everyMinute[4]!.getTime() - everyMinute[0]!.getTime()).toBe(240_000)
  })
  it('anchors wildcard day steps at day one, not zero', () => {
    vi.setSystemTime(new Date(2024, 2, 1, 0, 0, 0))
    expect(getNextCronRuns(fields('0 0 */2 * *'), 3).map(date => date.getDate()))
      .toEqual([3, 5, 7])
  })
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid requested count %s', count => {
    expect(getNextCronRuns(fields('* * * * *'), count)).toEqual([])
  })
  it('translates helper phrases and weekdays without changing the expression', async () => {
    const translator = i18n.createInstance()
    await translator.init({
      lng: 'de', resources: { de: { translation: { devtools: { utils: {
        cronAtTime: 'Um {{time}}',
        cronOnWeekday: 'am {{weekday}}',
      } } } } },
      interpolation: { escapeValue: false },
    })
    expect(describeCron(fields('30 9 * * 1'), translator.t, 'de-DE')).toBe('Um 09:30 am Mo')
  })
})

describe('phase6 relative time and calculator presentation', () => {
  it.each([-3_600_000, 3_600_000, -86_400_000, 86_400_000])(
    'delegates signed temporal direction and locale to the shared formatter: %s', offset => {
      const date = new Date(Date.now() + offset)
      expect(getRelativeTime(date, { locale: 'de-DE' }))
        .toBe(formatRelative(date, { locale: 'de-DE' }))
      expect(getRelativeTime(date)).toContain(offset > 0 ? 'in ' : ' ago')
    },
  )
  it('keeps future seconds future and invalid dates unknown', () => {
    expect(getRelativeTime(new Date(Date.now() + 45_000))).toBe('in 45s')
    expect(getRelativeTime(new Date('invalid'))).toBe('—')
  })
  it('shows invalid cron syntax as an alert and preserves every preset', () => {
    render(createElement(CronParserTool))
    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: 'a b c d e' } })
    expect(screen.getByRole('alert').textContent).toContain('Invalid cron expression')
    expect(screen.queryByText('Next runs')).toBeNull()
    for (const name of ['Every minute', 'Every hour', 'Every day', 'Every week', 'Every month']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
  it('shows five runs using the saved date locale and zone', () => {
    render(createElement(CronParserTool))
    fireEvent.click(screen.getByRole('button', { name: 'Every hour' }))
    const runs = getNextCronRuns(fields('0 * * * *'), 5)
    for (const date of runs) {
      expect(screen.getByText(formatDateTime(date, { locale: 'de-DE', tz: 'Europe/Berlin' }))).toBeTruthy()
    }
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it.each(['-1', '-1000000000000'])('keeps negative Unix epochs and raw ISO output: %s', input => {
    render(createElement(TimestampTool))
    fireEvent.change(screen.getByLabelText('Unix timestamp'), { target: { value: input } })
    const date = new Date(input.length - 1 > 10 ? Number(input) : Number(input) * 1000)
    expect(screen.getByText(date.toISOString())).toBeTruthy()
    expect(screen.getByText(formatDateTime(date, { locale: 'de-DE', tz: 'Europe/Berlin' }))).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('uses saved numeric grouping without changing machine-readable input or ISO', () => {
    setGlobalLocale('de-DE')
    render(createElement(TimestampTool))
    const iso = '2030-01-01T00:00:00.000Z'
    fireEvent.change(screen.getByLabelText('ISO timestamp'), { target: { value: iso } })
    expect(screen.getByText(fmtInt(new Date(iso).getTime() / 1000))).toBeTruthy()
    expect((screen.getByLabelText('ISO timestamp') as HTMLInputElement).value).toBe(iso)
    fireEvent.click(screen.getByRole('button', { name: 'Now' }))
    expect((screen.getByLabelText('Unix timestamp') as HTMLInputElement).value)
      .toBe(String(Math.floor(Date.now() / 1000)))
  })
})
