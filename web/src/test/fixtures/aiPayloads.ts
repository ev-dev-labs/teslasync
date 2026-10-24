import { vi } from 'vitest'
import type { AppSettings } from '@/api/types'
import {
  appSettingsPayload,
  createAppSettings,
  normalizeAiFeatures,
  normalizeAiMode,
  type AiMode,
} from './appSettings'

export interface AiFeatureSettingsOptions {
  mode?: unknown
  enabled?: boolean
  overrides?: Partial<AppSettings>
}

export function createAiFeatureSettings(
  featureId: string,
  options: AiFeatureSettingsOptions = {},
): AppSettings {
  if (!featureId.trim()) throw new Error('AI feature fixture requires a non-empty feature ID')

  const mode = normalizeAiMode(options.mode ?? 'off')
  const enabled = typeof options.enabled === 'boolean' ? options.enabled : false
  return createAppSettings({
    ...options.overrides,
    ai_mode: mode,
    ai_features: {
      ...normalizeAiFeatures(options.overrides?.ai_features),
      [featureId]: enabled,
    },
  })
}

export function aiFeatureSettingsPayload(
  featureId: string,
  options: AiFeatureSettingsOptions = {},
): { settings: AppSettings } {
  return { settings: createAiFeatureSettings(featureId, options) }
}

export function aiSettingsPayload(
  featureId: string,
  mode: AiMode | unknown = 'cloud',
  enabled = true,
  overrides?: Partial<AppSettings>,
): { settings: AppSettings } {
  return aiFeatureSettingsPayload(featureId, { mode, enabled, overrides })
}

export function mergeSettingsPayload(
  base: Partial<AppSettings> = {},
  overrides: Partial<AppSettings> = {},
): { settings: AppSettings } {
  return appSettingsPayload({
    ...base,
    ...overrides,
    ai_features: {
      ...normalizeAiFeatures(base.ai_features),
      ...normalizeAiFeatures(overrides.ai_features),
    },
  })
}

export function makeReadableStream(
  chunks: ReadonlyArray<string>,
  options?: { onCancel?: () => void },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
      } else {
        controller.close()
      }
    },
    cancel() {
      options?.onCancel?.()
    },
  })
}

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function sseFrames(frames: ReadonlyArray<{ event: string; data: unknown }>): string {
  return frames.map(({ event, data }) => sseFrame(event, data)).join('')
}

export function toolResultBody(
  name: string,
  data: unknown,
  options: {
    id?: string
    ok?: boolean
    arguments?: unknown
    error?: string
  } = {},
): string {
  const id = options.id ?? 'tc1'
  return (
    sseFrame('tool_call', {
      id,
      name,
      arguments: options.arguments ?? {},
    })
    + sseFrame('tool_result', {
      id,
      name,
      ok: options.ok ?? true,
      ...(options.error ? { error: options.error } : {}),
      data,
    })
  )
}

export interface AiFetchCall {
  url: string
  init: RequestInit | undefined
}

export interface AiFetchMock {
  calls: AiFetchCall[]
  cleanup: () => void
}

export function installAiFetchMock(
  sseBody: string,
  status = 200,
): AiFetchMock {
  const previous = globalThis.fetch
  const calls: AiFetchCall[] = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    if (status !== 200) return new Response(null, { status })
    return new Response(makeReadableStream([sseBody]), {
      status,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch

  let cleaned = false
  return {
    calls,
    cleanup: () => {
      if (cleaned) return
      cleaned = true
      globalThis.fetch = previous
    },
  }
}
