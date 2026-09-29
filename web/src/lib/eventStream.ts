/**
 * @module lib/eventStream
 *
 * EventSource factory that keeps live streams working in remote mode
 * (docs/apps.md).
 *
 * Same-origin without a stored token, this is exactly `new EventSource`
 * — zero behaviour change. Otherwise the URL is absolute (a relative
 * path would resolve against the shell bundle origin) and, when a
 * personal access token is stored, the stream runs over fetch: the
 * native EventSource API cannot set an `Authorization` header.
 *
 * The fetch transport implements the EventSource surface this codebase
 * uses (`addEventListener`/`removeEventListener`, `close`, `onopen` /
 * `onerror` / `onmessage`, `readyState`, `url`) including native-like
 * auto-reconnect with backoff. Reconnect does NOT resume from a
 * Last-Event-ID — the backend streams are live-only, matching what the
 * in-house reconnect loops in sseManager/automationSSE already assume.
 */

import { authHeaders, getAccessToken, serverCredentials, serverStreamUrl } from './serverConnection'

const DEFAULT_RETRY_MS = 3000

interface StreamInit {
  withCredentials?: boolean
}

/**
 * Open a server-sent-events stream. Drop-in replacement for
 * `new EventSource(url, init)` that stays on the native transport in
 * same-origin mode and switches to an authenticated fetch transport
 * when a server connection is stored.
 */
export function createEventStream(pathOrUrl: string, init?: StreamInit): EventSource {
  const url = serverStreamUrl(pathOrUrl)
  if (getAccessToken() == null) {
    return new EventSource(url, init)
  }
  return new FetchEventStream(url) as unknown as EventSource
}

/**
 * Minimal SSE-over-fetch reader implementing the EventSource members
 * used across the app. One-shot frames (`event:`/`data:`) are parsed
 * incrementally; comments and unknown fields are ignored.
 */
class FetchEventStream extends EventTarget {
  readonly url: string
  readyState: number = EventSource.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  private aborter: AbortController | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryMs = DEFAULT_RETRY_MS
  private userClosed = false

  constructor(url: string) {
    super()
    this.url = url
    // Defer so callers can attach listeners before `open`/`error` fire,
    // matching native EventSource's async connect.
    queueMicrotask(() => {
      if (!this.userClosed) void this.connect()
    })
  }

  close(): void {
    this.userClosed = true
    this.readyState = EventSource.CLOSED
    this.aborter?.abort()
    this.aborter = null
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private emit(type: 'open' | 'error', ev: Event): void
  private emit(type: string, ev: MessageEvent): void
  private emit(type: string, ev: Event | MessageEvent): void {
    // IDL handlers first (native order), then registered listeners.
    if (type === 'open') this.onopen?.(ev as Event)
    else if (type === 'error') this.onerror?.(ev as Event)
    else if (type === 'message') this.onmessage?.(ev as MessageEvent)
    this.dispatchEvent(type === 'open' || type === 'error'
      ? new Event(type)
      : new MessageEvent(type, { data: (ev as MessageEvent).data }))
  }

  private scheduleReconnect(): void {
    if (this.userClosed || this.retryTimer != null) return
    this.readyState = EventSource.CONNECTING
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.userClosed) void this.connect()
    }, this.retryMs)
  }

  private async connect(): Promise<void> {
    this.aborter?.abort()
    const aborter = new AbortController()
    this.aborter = aborter
    try {
      const res = await fetch(this.url, {
        headers: authHeaders({ Accept: 'text/event-stream' }),
        credentials: serverCredentials(),
        signal: aborter.signal,
      })
      if (aborter.signal.aborted) return
      if (!res.ok || res.body == null) {
        const terminal = res.status === 401 || res.status === 403
        this.readyState = terminal ? EventSource.CLOSED : EventSource.CONNECTING
        this.emit('error', new Event('error'))
        // Auth failures are terminal — retrying a rejected token is a
        // hammer loop; the auth UI surfaces the failure instead.
        if (terminal) return
        this.scheduleReconnect()
        return
      }
      this.readyState = EventSource.OPEN
      this.emit('open', new Event('open'))
      await this.pump(res.body, aborter.signal)
      // Clean EOF (server closed the stream): reconnect like native.
      if (!aborter.signal.aborted && !this.userClosed) {
        this.emit('error', new Event('error'))
        this.scheduleReconnect()
      }
    } catch {
      if (aborter.signal.aborted || this.userClosed) return
      this.readyState = EventSource.CONNECTING
      this.emit('error', new Event('error'))
      this.scheduleReconnect()
    }
  }

  private async pump(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal.aborted) break
        buffer += decoder.decode(value, { stream: true })
        buffer = this.dispatchFrames(buffer)
      }
    } finally {
      reader.releaseLock()
    }
  }

  /** Parse complete `\n\n`-terminated frames; return the leftover partial frame. */
  private dispatchFrames(buffer: string): string {
    const normalized = buffer.replace(/\r\n/g, '\n')
    const frames = normalized.split('\n\n')
    const leftover = frames.pop() ?? ''
    for (const frame of frames) {
      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line === '' || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = (colon === -1 ? line : line.slice(0, colon)).trim()
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') {
          if (value !== '') event = value
        } else if (field === 'data') {
          dataLines.push(value)
        } else if (field === 'retry' && /^\d+$/.test(value)) {
          this.retryMs = Math.min(Math.max(Number(value), 250), 30_000)
        }
      }
      // A frame with no data lines (e.g. bare `retry:`) dispatches nothing.
      if (dataLines.length === 0) continue
      this.emit(event, new MessageEvent(event, { data: dataLines.join('\n') }))
    }
    return leftover
  }
}
