import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { personalIdentityKey } from '@/api/hooks/usePersonalIdentity'
import SmartFeaturesPage from './SmartFeaturesPage'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/setup')
  return createReactI18nextMock()
})
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}))
vi.mock('@/components/layout', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
  PageLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const list = '/settings/smart-features'
const recall = { feature: 'recall_watch', allowed: true }
const charging = { feature: 'charging_readiness', allowed: true }
const identity = (subject: string) => ({ mode: 'forward_auth', subject, impersonating: false })
const featureSwitch = (name: RegExp) => screen.findByRole('switch', { name })

function openPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><SmartFeaturesPage /></MemoryRouter></QueryClientProvider>)
  return client
}

describe('Smart Features permissions', () => {
  it('waits for a verified save and changes only the requested feature', async () => {
    let finishSave: () => void = () => { throw new Error('No save in progress') }
    let allowed = true
    const requests = vi.mocked(request).mockReset().mockImplementation(async (path, options) => {
      if (path === '/system/auth-mode') return identity('account A')
      if (path === list) return { data: [{ ...recall, allowed }, charging] }
      if (path === `${list}/recall_watch` && options?.method === 'PUT') {
        await new Promise<void>(resolve => { finishSave = resolve })
        allowed = false
        return { data: { ...recall, allowed } }
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    openPage()
    const control = await featureSwitch(/allow recall watch/i)
    const independent = await featureSwitch(/allow charging readiness/i)
    fireEvent.click(control)
    await waitFor(() => expect(requests).toHaveBeenCalledWith(`${list}/recall_watch`, expect.objectContaining({
      method: 'PUT',
      body: '{"allowed":false}',
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:account%20A' },
    })))
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(independent).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { finishSave() })
    await waitFor(() => expect(control).toHaveAttribute('aria-checked', 'false'))
    expect(independent).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the last verified value on save failure and never retries it for another principal', async () => {
    const requests = vi.mocked(request).mockReset().mockImplementation(async path => {
      if (path === '/system/auth-mode') return identity('first')
      if (path === list) return { data: [recall] }
      if (path === `${list}/recall_watch`) throw new Error('Synthetic save failure')
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = openPage()
    fireEvent.click(await featureSwitch(/allow recall watch/i))
    expect(await screen.findByText(/could not save that permission/i)).toBeVisible()
    expect(await featureSwitch(/allow recall watch/i)).toHaveAttribute('aria-checked', 'true')
    act(() => { client.setQueryData(personalIdentityKey, identity('second')) })
    await waitFor(() => expect(requests).toHaveBeenCalledWith(list, expect.objectContaining({
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:second' },
    })))
    expect(screen.queryByText(/could not save that permission/i)).not.toBeInTheDocument()
    expect(requests.mock.calls.filter(([path]) => path === `${list}/recall_watch`)).toHaveLength(1)
  })

  it('offers a retry instead of rendering unverified preferences from a malformed response', async () => {
    let payload: unknown = { data: [{ ...recall, allowed: 'false' }] }
    vi.mocked(request).mockReset().mockImplementation(async path => {
      if (path === '/system/auth-mode') return identity('account A')
      if (path === list) return payload
      throw new Error(`Unexpected request: ${path}`)
    })
    openPage()
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    payload = { data: [{ ...recall, allowed: false }] }
    fireEvent.click(retry)
    expect(await featureSwitch(/allow recall watch/i)).toHaveAttribute('aria-checked', 'false')
  })
})
