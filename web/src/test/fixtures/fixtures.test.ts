import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  appSettingsPayload,
  createAppSettings,
  mergeFixturePayload,
  normalizeAppSettings,
  normalizeAiFeatures,
  normalizeAiMode,
  settingsPayload,
} from './appSettings'
import {
  aiFeatureSettingsPayload,
  aiSettingsPayload,
  createAiFeatureSettings,
  installAiFetchMock,
  makeReadableStream,
  mergeSettingsPayload,
  sseFrame,
  sseFrames,
  toolResultBody,
} from './aiPayloads'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('AppSettings fixtures', () => {
  it('supplies complete defaults when fields are missing', () => {
    const settings = createAppSettings()

    expect(settings).toEqual(DEFAULT_APP_SETTINGS)
    expect(settings.currency_symbol).toBe('$')
    expect(settings.locale).toBe('en-US')
    expect(settings.timezone_user).toBe('')
    expect(settings.ai_features).toEqual({})
  })

  it('normalizes new, missing and invalid settings fields', () => {
    const normalized = normalizeAppSettings({
      ai_mode: 'unexpected',
      ai_features: {
        'chatbot-llm': true,
        invalid: 'yes',
      },
      decimal_precision: Number.NaN,
      locale: '   ',
      timezone_user: null,
      ui_density: 'invalid',
      tz_display_default: 'invalid',
    } as unknown)

    expect(normalized.ai_mode).toBe('off')
    expect(normalized.ai_features).toEqual({ 'chatbot-llm': true })
    expect(normalized.decimal_precision).toBe(2)
    expect(normalized.locale).toBe('en-US')
    expect(normalized.timezone_user).toBe('')
    expect(normalized.ui_density).toBe('comfortable')
    expect(normalized.tz_display_default).toBe('vehicle')
  })

  it('merges settings payload overrides and preserves the base settings object', () => {
    const basePayload = appSettingsPayload({ ai_features: { alpha: true } })
    const mergedPayload = mergeSettingsPayload(
      { ai_features: { alpha: true } },
      { ai_features: { beta: true }, decimal_precision: 1 },
    )

    expect(basePayload.settings.ai_features).toEqual({ alpha: true })
    expect(mergedPayload.settings.ai_features).toEqual({ alpha: true, beta: true })
    expect(mergedPayload.settings.decimal_precision).toBe(1)
    expect(DEFAULT_APP_SETTINGS.decimal_precision).toBe(2)
  })

  it('supports generic nested payload merges without mutating the inputs', () => {
    const base = { nested: { alpha: true }, list: [1] }
    const overrides = { nested: { beta: true }, list: [2] }

    const merged = mergeFixturePayload(base, overrides)
    expect(merged).toEqual({ nested: { alpha: true, beta: true }, list: [2] })
    expect(base).toEqual({ nested: { alpha: true }, list: [1] })
  })

  it('exports the repeated settingsPayload helper shape', () => {
    expect(settingsPayload({ locale: 'de-DE' })).toEqual({
      settings: expect.objectContaining({ locale: 'de-DE' }),
    })
  })
})

describe('AI fixture helpers', () => {
  it('toggles off, local and cloud modes while enabling feature flags', () => {
    expect(createAiFeatureSettings('chatbot-llm', { mode: 'off', enabled: true }).ai_mode)
      .toBe('off')
    expect(createAiFeatureSettings('chatbot-llm', { mode: 'local', enabled: true }).ai_mode)
      .toBe('local')
    expect(createAiFeatureSettings('chatbot-llm', { mode: 'cloud', enabled: false }))
      .toMatchObject({
        ai_mode: 'cloud',
        ai_features: { 'chatbot-llm': false },
      })
  })

  it('fails closed for unknown modes and invalid feature maps', () => {
    expect(normalizeAiMode('unknown')).toBe('off')
    expect(normalizeAiMode(undefined)).toBe('off')
    expect(normalizeAiFeatures({ valid: true, invalid: 'true' })).toEqual({ valid: true })

    expect(aiFeatureSettingsPayload('test-feature', {
      mode: 'unexpected',
      enabled: true,
    }).settings).toMatchObject({
      ai_mode: 'off',
      ai_features: { 'test-feature': true },
    })
    expect(aiSettingsPayload('chatbot-llm', 'cloud', true).settings.ai_features)
      .toEqual({ 'chatbot-llm': true })
  })

  it('rejects an empty feature ID instead of creating an invalid payload', () => {
    expect(() => createAiFeatureSettings('   ', { mode: 'cloud', enabled: true }))
      .toThrow('non-empty feature ID')
  })

  it('frames SSE payloads and chunks readable streams', async () => {
    const body = sseFrames([
      { event: 'delta', data: { text: 'hello' } },
      { event: 'done', data: { finish_reason: 'stop', usage: { in: 2, out: 1 } } },
    ])
    expect(sseFrame('delta', { text: 'hello' }))
      .toBe('event: delta\ndata: {"text":"hello"}\n\n')
    expect(body).toContain('event: done')

    const stream = makeReadableStream([body.slice(0, 12), body.slice(12)])
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let assembled = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      assembled += decoder.decode(value, { stream: true })
    }
    expect(assembled).toBe(body)
  })

  it('builds tool-result payloads with mergeable data', () => {
    const body = toolResultBody('draft_location_name', { location_id: 501 }, {
      id: 'tc1',
      ok: true,
      arguments: { location_id: 501 },
    })

    expect(body).toContain('event: tool_call')
    expect(body).toContain('"name":"draft_location_name"')
    expect(body).toContain('"ok":true')
    expect(body).toContain('"location_id":501')
  })

  it('cleans up fetch mocks and stream cancellation handlers', async () => {
    const previousFetch = globalThis.fetch
    let cancelCount = 0
    const stream = makeReadableStream(['hello'], {
      onCancel: () => { cancelCount += 1 },
    })
    await stream.cancel()
    expect(cancelCount).toBe(1)

    const mock = installAiFetchMock(sseFrame('delta', { text: 'hello' }))
    expect(globalThis.fetch).not.toBe(previousFetch)
    mock.cleanup()
    mock.cleanup()
    expect(globalThis.fetch).toBe(previousFetch)
  })
})
