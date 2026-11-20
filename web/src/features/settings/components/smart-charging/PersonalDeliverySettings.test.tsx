import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalDeliveryDevice } from '@/types/personalDelivery'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  supported: vi.fn(),
  getSubscription: vi.fn(),
  subscribe: vi.fn(),
  clear: vi.fn(),
}))
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: mocks.request,
}))
vi.mock('@/lib/personalPush', () => ({
  personalPushSupported: mocks.supported,
  getPersonalSubscription: mocks.getSubscription,
  subscribePersonalBrowser: mocks.subscribe,
  clearPersonalBrowser: mocks.clear,
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string) => value }),
}))

import { ApiError } from '@/api/client'
import { personalDeliveryKeys } from '@/api/hooks/usePersonalDelivery'
import { personalIdentityKey } from '@/api/hooks/usePersonalIdentity'
import { PersonalDeliverySettings } from './PersonalDeliverySettings'

const endpoint = 'https://push.example.test/synthetic-browser'
const subscription = {
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } }),
} as PushSubscription
type StoredDevice = { endpoint: string; device: PersonalDeliveryDevice }
let subject: string
let devices: Record<string, StoredDevice[]>
let browserSubscription: PushSubscription | null
let deleteFailure: boolean
let holdLookup: Promise<void> | null

function stored(id: number, verified: boolean, pushEndpoint = endpoint): StoredDevice {
  return {
    endpoint: pushEndpoint,
    device: { id, verified, charging_enabled: false,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z' },
  }
}

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return {
    client,
    ...render(<QueryClientProvider client={client}><PersonalDeliverySettings active /></QueryClientProvider>),
  }
}

beforeEach(() => {
  subject = 'synthetic-a'
  devices = { 'synthetic-a': [], 'synthetic-b': [] }
  browserSubscription = null
  deleteFailure = false
  holdLookup = null
  mocks.request.mockReset()
  mocks.supported.mockReset().mockReturnValue(true)
  mocks.getSubscription.mockReset().mockImplementation(async () => browserSubscription)
  mocks.subscribe.mockReset().mockImplementation(async () => {
    browserSubscription = subscription
    return subscription
  })
  mocks.clear.mockReset().mockImplementation(async () => { browserSubscription = null })
  mocks.request.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/system/auth-mode') return { mode: 'forward_auth', subject }
    const header = (options?.headers as Record<string, string> | undefined)?.['X-TeslaSync-Expected-Principal']
    if (header !== `subject:${subject}`) throw new ApiError('Identity changed', 409, 'IDENTITY_CHANGED')
    if (path === '/smart-delivery/devices' && !options?.method) {
      return { data: { available: true, public_key: 'vapid-key', devices: devices[subject].map((item) => item.device) } }
    }
    if (path === '/smart-delivery/devices/lookup') {
      const requestSubject = subject
      if (holdLookup) await holdLookup
      const input = JSON.parse(String(options?.body)) as { endpoint: string }
      const found = devices[requestSubject].find((item) => item.endpoint === input.endpoint)
      if (!found) throw new ApiError('Not found', 404)
      return { data: { ...found.device } }
    }
    if (path === '/smart-delivery/devices' && options?.method === 'POST') {
      const input = JSON.parse(String(options.body)) as { subscription: { endpoint: string } }
      devices[subject] = [stored(1, false, input.subscription.endpoint)]
      return { data: devices[subject][0].device }
    }
    const charging = path.match(/^\/smart-delivery\/devices\/(\d+)\/charging$/)
    if (charging && options?.method === 'PUT') {
      const input = JSON.parse(String(options.body)) as { enabled: boolean }
      const target = devices[subject].find((item) => item.device.id === Number(charging[1]))
      if (!target) throw new ApiError('Not found', 404)
      target.device.charging_enabled = input.enabled
      return undefined
    }
    const deletion = path.match(/^\/smart-delivery\/devices\/(\d+)$/)
    if (deletion && options?.method === 'DELETE') {
      if (deleteFailure) throw new ApiError('Unavailable', 503)
      devices[subject] = devices[subject].filter((item) => item.device.id !== Number(deletion[1]))
      return undefined
    }
    throw new Error(`Unexpected request: ${path}`)
  })
})

afterEach(() => vi.restoreAllMocks())

describe('personal delivery settings', () => {
  it('requires explicit enrollment, proof of possession, and separate charging consent', async () => {
    const { client } = renderSettings()
    const connect = await screen.findByRole('button', { name: 'Connect this browser' })
    await waitFor(() => expect(connect).toBeEnabled())
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)

    fireEvent.click(connect)
    const pending = await screen.findByRole('switch', { name: 'Allow charging readiness notifications on This browser' })
    expect(pending).toBeDisabled()
    expect(pending).toHaveAttribute('aria-checked', 'false')
    const enroll = mocks.request.mock.calls.find(([path, options]) =>
      path === '/smart-delivery/devices' && options?.method === 'POST')
    expect(enroll?.[1]).toMatchObject({
      requiresLiveMode: true, cache: 'no-store',
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-a' },
    })
    expect(JSON.parse(String(enroll?.[1].body))).toMatchObject({
      subscription: { endpoint, p256dh: 'public-key', auth: 'auth-key' },
    })
    expect(mocks.request.mock.calls.some(([path]) => String(path).endsWith('/charging'))).toBe(false)

    devices[subject][0].device.verified = true
    await act(async () => { await client.invalidateQueries({ queryKey: personalDeliveryKeys.all }) })
    const toggle = await screen.findByRole('switch', { name: 'Allow charging readiness notifications on This browser' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(mocks.request).toHaveBeenCalledWith('/smart-delivery/devices/1/charging', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ enabled: true }),
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-a' },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect This browser' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect this device?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect device' }))
    expect(await screen.findByText(/No personal devices are connected/)).toBeInTheDocument()
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce())
  })

  it('does not expose the previous account or enable actions while the new browser lookup is pending', async () => {
    browserSubscription = subscription
    devices['synthetic-a'] = [stored(1, true)]
    devices['synthetic-b'] = [stored(2, true, 'https://push.example.test/other-browser')]
    const { client } = renderSettings()
    expect(await screen.findByRole('switch', { name: 'Allow charging readiness notifications on This browser' })).toBeEnabled()

    let release: (() => void) | undefined
    holdLookup = new Promise<void>((resolve) => { release = resolve })
    subject = 'synthetic-b'
    await act(async () => { await client.invalidateQueries({ queryKey: personalIdentityKey }) })
    const other = await screen.findByRole('switch', { name: 'Allow charging readiness notifications on Device 1' })
    expect(other).toBeDisabled()
    expect(screen.queryByRole('switch', { name: 'Allow charging readiness notifications on This browser' })).not.toBeInTheDocument()
    await act(async () => { release?.() })
    await waitFor(() => expect(other).toBeEnabled())
    expect(mocks.request).toHaveBeenCalledWith('/smart-delivery/devices/lookup', expect.objectContaining({
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-b' },
    }))
    expect(mocks.request.mock.calls.some(([path, options]) =>
      String(path).endsWith('/charging') && options?.method === 'PUT')).toBe(false)
  })

  it('allows remote-device management in an unsupported browser and reports disconnect failures', async () => {
    mocks.supported.mockReturnValue(false)
    devices[subject] = [stored(4, true, 'https://push.example.test/remote')]
    renderSettings()
    expect(await screen.findByText(/supported browser and a secure, same-origin connection/)).toBeInTheDocument()
    const remove = await screen.findByRole('button', { name: 'Disconnect Device 1' })
    await waitFor(() => expect(remove).toBeEnabled())
    fireEvent.click(remove)
    const dialog = screen.getByRole('dialog', { name: 'Disconnect this device?' })
    deleteFailure = true
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect device' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be fully disconnected')
    deleteFailure = false
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect device' }))
    expect(await screen.findByText(/No personal devices are connected/)).toBeInTheDocument()
    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it('retries a failed browser lookup without enrolling or changing preferences', async () => {
    browserSubscription = subscription
    devices[subject] = [stored(1, true)]
    mocks.getSubscription.mockRejectedValueOnce(new Error('browser unavailable'))
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry checking this browser' }))
    expect(await screen.findByRole('switch', { name: 'Allow charging readiness notifications on This browser' })).toBeEnabled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.request.mock.calls.some(([path, options]) =>
      path === '/smart-delivery/devices' && options?.method === 'POST')).toBe(false)
  })
})
