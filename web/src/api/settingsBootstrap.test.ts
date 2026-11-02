import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('./client', () => ({ request: requestMock }))

import { getBootstrapSettings } from './settingsBootstrap'

describe('getBootstrapSettings', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deduplicates concurrent provider hydration without changing the response', async () => {
    const settings = { theme: 'tesla-red', font_sans: 'inter' }
    requestMock.mockResolvedValue(settings)

    const [themeSettings, fontSettings] = await Promise.all([
      getBootstrapSettings(),
      getBootstrapSettings(),
    ])

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith('/settings')
    expect(themeSettings).toEqual(settings)
    expect(fontSettings).toEqual(settings)
  })

  it('clears the single-flight promise after settlement', async () => {
    requestMock.mockResolvedValue({})

    await getBootstrapSettings()
    await getBootstrapSettings()

    expect(requestMock).toHaveBeenCalledTimes(2)
  })
})
