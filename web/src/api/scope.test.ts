import { describe, it, expect, vi } from 'vitest'

import {
  SupersededRequestError,
  createScopeSequencer,
  isSupersededOrAborted,
  scopeKey,
  scopeSearchParams,
  scopedPath,
  toSnakeCase,
} from './scope'

describe('toSnakeCase', () => {
  it('converts the camelCase params that silently break the Go handlers', () => {
    expect(toSnakeCase('vehicleId')).toBe('vehicle_id')
    expect(toSnakeCase('startDate')).toBe('start_date')
    expect(toSnakeCase('VIN')).toBe('vin')
    expect(toSnakeCase('minSOCPercent')).toBe('min_soc_percent')
    expect(toSnakeCase('already_snake')).toBe('already_snake')
    expect(toSnakeCase('kebab-case')).toBe('kebab_case')
  })
})

describe('scopeKey', () => {
  it('is stable regardless of filter insertion order', () => {
    const a = scopeKey({ vehicleId: 3, filters: { minSpeed: 10, maxSpeed: 90 } })
    const b = scopeKey({ vehicleId: 3, filters: { maxSpeed: 90, minSpeed: 10 } })
    expect(a).toEqual(b)
  })

  it('changes when any scope dimension changes', () => {
    const base = { vehicleId: 3, start: '2026-01-01', end: '2026-02-01' }
    expect(scopeKey(base)).not.toEqual(scopeKey({ ...base, vehicleId: 4 }))
    expect(scopeKey(base)).not.toEqual(scopeKey({ ...base, start: '2026-01-02' }))
    expect(scopeKey(base)).not.toEqual(scopeKey({ ...base, timezone: 'UTC' }))
    expect(scopeKey(base)).not.toEqual(scopeKey({ ...base, units: 'imperial' }))
  })

  it('normalises a numeric and string vehicle id to the same key', () => {
    expect(scopeKey({ vehicleId: 3 })).toEqual(scopeKey({ vehicleId: '3' }))
  })

  it('emits nulls for absent dimensions so keys cannot collide by prefix', () => {
    expect(scopeKey({})).toEqual([null, null, null, null, null, []])
  })

  it('drops empty filter values rather than keying on ""', () => {
    expect(scopeKey({ filters: { q: '', page: 2 } })).toEqual(
      scopeKey({ filters: { page: 2 } }),
    )
  })
})

describe('scopeSearchParams', () => {
  it('emits snake_case only', () => {
    const qs = scopeSearchParams({ vehicleId: 7, filters: { minSpeed: 10, sortBy: 'started_at' } })
    expect(qs).not.toMatch(/[A-Z]/)
    expect(qs).toContain('vehicle_id=7')
    expect(qs).toContain('min_speed=10')
    expect(qs).toContain('sort_by=started_at')
  })

  it('omits unknown values instead of serialising null / NaN / empty', () => {
    const qs = scopeSearchParams({
      vehicleId: null,
      start: '',
      end: undefined,
      filters: { a: null, b: Number.NaN, c: undefined, d: 0 },
    })
    expect(qs).toBe('d=0')
  })

  it('excludes presentation params unless explicitly requested', () => {
    const scope = { vehicleId: 1, timezone: 'America/Los_Angeles', units: 'imperial' }
    expect(scopeSearchParams(scope)).toBe('vehicle_id=1')
    const withPresentation = scopeSearchParams(scope, { includePresentation: true })
    expect(withPresentation).toContain('timezone=America%2FLos_Angeles')
    expect(withPresentation).toContain('units=imperial')
  })

  it('produces byte-identical output for equivalent scopes', () => {
    expect(scopeSearchParams({ filters: { b: 2, a: 1 } })).toBe(
      scopeSearchParams({ filters: { a: 1, b: 2 } }),
    )
  })
})

describe('scopedPath', () => {
  it('never double-prefixes /api/v1', () => {
    expect(scopedPath('/api/v1/drives', { vehicleId: 2 })).toBe('/drives?vehicle_id=2')
    expect(scopedPath('drives', { vehicleId: 2 })).toBe('/drives?vehicle_id=2')
    expect(scopedPath('/drives', {})).toBe('/drives')
  })

  it('merges rather than clobbers an existing query string', () => {
    const path = scopedPath('/drives?limit=50', { vehicleId: 2 })
    expect(path).toContain('limit=50')
    expect(path).toContain('vehicle_id=2')
  })

  it('lets the scope win over a stale inline param of the same name', () => {
    expect(scopedPath('/drives?vehicle_id=9', { vehicleId: 2 })).toBe('/drives?vehicle_id=2')
  })
})

describe('scopedPath — literal "?" inside a query value', () => {
  function queryOf(path: string): URLSearchParams {
    const q = path.indexOf('?')
    if (q < 0) return new URLSearchParams()
    const rest = path.slice(q + 1)
    const hash = rest.indexOf('#')
    return new URLSearchParams(hash < 0 ? rest : rest.slice(0, hash))
  }

  it('preserves everything after the FIRST "?" as query data', () => {
    // `split('?', 2)` silently truncated `search=a?b` to `search=a`, so the
    // user's own query text was corrupted on the wire.
    const path = scopedPath('/drives?search=a?b')
    expect(queryOf(path).get('search')).toBe('a?b')
  })

  it('keeps a multi-"?" value intact', () => {
    expect(queryOf(scopedPath('/drives?search=a?b?c')).get('search')).toBe('a?b?c')
  })

  it('re-encodes the literal "?" so the emitted URL is unambiguous', () => {
    const path = scopedPath('/drives?search=a?b')
    expect(path).toContain('search=a%3Fb')
    expect(path).not.toContain('search=a?b')
  })

  it('round-trips an already-encoded "?" identically', () => {
    expect(queryOf(scopedPath('/drives?search=a%3Fb')).get('search')).toBe('a?b')
    expect(scopedPath('/drives?search=a%3Fb')).toBe(scopedPath('/drives?search=a?b'))
  })

  it('merges scope params without losing the "?" value', () => {
    const path = scopedPath('/drives?search=a?b', { vehicleId: 2 })
    const params = queryOf(path)
    expect(params.get('search')).toBe('a?b')
    expect(params.get('vehicle_id')).toBe('2')
  })

  it('lets the scope replace a param whose value contains "?"', () => {
    const params = queryOf(scopedPath('/drives?vehicle_id=9?stale', { vehicleId: 2 }))
    expect(params.get('vehicle_id')).toBe('2')
  })

  it('combines a "?" value with a fragment correctly', () => {
    const path = scopedPath('/drives?search=a?b#summary', { vehicleId: 2 })
    expect(path.endsWith('#summary')).toBe(true)
    const params = queryOf(path)
    expect(params.get('search')).toBe('a?b')
    expect(params.get('vehicle_id')).toBe('2')
  })

  it('does not let a "?" in the value leak into the fragment', () => {
    const path = scopedPath('/drives?search=a?b#top')
    expect(path.split('#')).toHaveLength(2)
    expect(path.split('#')[1]).toBe('top')
  })
})

describe('scopedPath — URL fragments', () => {
  it('preserves a fragment when there is no query at all', () => {
    expect(scopedPath('/drives#summary')).toBe('/drives#summary')
  })

  it('appends scope params BEFORE the fragment', () => {
    // Naive parsing produced `/drives#summary?vehicle_id=2`, which points the
    // browser at an anchor named `summary?vehicle_id=2` and sends no params.
    expect(scopedPath('/drives#summary', { vehicleId: 2 })).toBe('/drives?vehicle_id=2#summary')
  })

  it('merges with an existing query and still keeps the fragment last', () => {
    const path = scopedPath('/drives?limit=50#summary', { vehicleId: 2 })
    expect(path).toBe('/drives?limit=50&vehicle_id=2#summary')
  })

  it('does not fuse the fragment into the last param value', () => {
    // The regression: `limit` used to come back as `50#summary`.
    const params = new URLSearchParams(
      scopedPath('/drives?limit=50#summary', {}).split('?')[1]?.split('#')[0] ?? '',
    )
    expect(params.get('limit')).toBe('50')
  })

  it('lets the scope replace an inline param while keeping the fragment', () => {
    expect(scopedPath('/drives?vehicle_id=9#top', { vehicleId: 2 }))
      .toBe('/drives?vehicle_id=2#top')
  })

  it('treats only the FIRST # as the delimiter and never re-parses inside it', () => {
    // A '?' inside a fragment is a literal, not a query delimiter.
    expect(scopedPath('/drives#a?b=c', { vehicleId: 2 })).toBe('/drives?vehicle_id=2#a?b=c')
    expect(scopedPath('/drives#a#b', { vehicleId: 2 })).toBe('/drives?vehicle_id=2#a#b')
  })

  it('URL-encodes param values without touching the fragment', () => {
    const path = scopedPath('/drives#Übersicht', {
      vehicleId: 2,
      filters: { place: 'San José & Co' },
    })
    expect(path).toContain('place=San+Jos%C3%A9+%26+Co')
    expect(path.endsWith('#Übersicht')).toBe(true)
  })

  it('strips the /api/v1 prefix and keeps the fragment', () => {
    expect(scopedPath('/api/v1/drives#summary', { vehicleId: 2 }))
      .toBe('/drives?vehicle_id=2#summary')
  })

  it('handles a bare fragment-only path', () => {
    expect(scopedPath('/#top')).toBe('/#top')
    expect(scopedPath('/#top', { vehicleId: 1 })).toBe('/?vehicle_id=1#top')
  })

  it('keeps an empty fragment marker verbatim', () => {
    expect(scopedPath('/drives#', { vehicleId: 2 })).toBe('/drives?vehicle_id=2#')
  })
})

describe('createScopeSequencer — superseded responses are rejected', () => {
  it('rejects a slow response for the previous vehicle instead of applying it', async () => {
    const sequencer = createScopeSequencer()
    let resolveFirst: (value: string) => void = () => {}

    const first = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>((resolve) => { resolveFirst = resolve }))
    const firstAssertion = expect(first).rejects.toBeInstanceOf(SupersededRequestError)

    const second = sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'vehicle-2')

    // The first request finally answers AFTER the scope changed.
    resolveFirst('vehicle-1')

    await expect(second).resolves.toBe('vehicle-2')
    await firstAssertion
  })

  it('aborts the superseded run through its AbortSignal', async () => {
    const sequencer = createScopeSequencer()
    const aborted = vi.fn()

    const first = sequencer.run(scopeKey({ vehicleId: 1 }), (signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted()
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }))
    const firstAssertion = expect(first).rejects.toBeInstanceOf(SupersededRequestError)

    await expect(
      sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'ok'),
    ).resolves.toBe('ok')

    expect(aborted).toHaveBeenCalledTimes(1)
    await firstAssertion
  })

  it('does not abort a re-run of the SAME scope', async () => {
    const sequencer = createScopeSequencer()
    const signals: AbortSignal[] = []

    await sequencer.run(scopeKey({ vehicleId: 1 }), async (signal) => {
      signals.push(signal)
      return 'a'
    })
    await sequencer.run(scopeKey({ vehicleId: 1 }), async (signal) => {
      signals.push(signal)
      return 'b'
    })

    expect(signals[0]?.aborted).toBe(false)
  })

  it('resolves BOTH truly-concurrent same-scope runs', async () => {
    // Regression guard: a per-call token made the second concurrent call its
    // own generation, so the first — still perfectly valid for the scope the
    // user is looking at — rejected with SupersededRequestError.
    const sequencer = createScopeSequencer()
    const scope = scopeKey({ vehicleId: 1 })

    let resolveFirst: (value: string) => void = () => {}
    let resolveSecond: (value: string) => void = () => {}
    const firstSignals: AbortSignal[] = []

    const first = sequencer.run(scope, (signal) => {
      firstSignals.push(signal)
      return new Promise<string>((resolve) => { resolveFirst = resolve })
    })
    const second = sequencer.run(scope, (signal) => {
      firstSignals.push(signal)
      return new Promise<string>((resolve) => { resolveSecond = resolve })
    })

    expect(sequencer.inFlightCount).toBe(2)
    // Neither peer is cancelled by the other.
    expect(firstSignals[0]?.aborted).toBe(false)
    expect(firstSignals[1]?.aborted).toBe(false)

    // Resolve out of order to prove ordering is irrelevant for same-scope peers.
    resolveSecond('second')
    resolveFirst('first')

    await expect(second).resolves.toBe('second')
    await expect(first).resolves.toBe('first')
    expect(sequencer.inFlightCount).toBe(0)
  })

  it('supersedes EVERY concurrent run of the old scope when the scope changes', async () => {
    const sequencer = createScopeSequencer()
    const oldScope = scopeKey({ vehicleId: 1 })

    let resolveA: (value: string) => void = () => {}
    let resolveB: (value: string) => void = () => {}
    const aborted: boolean[] = []

    const a = sequencer.run(oldScope, (signal) => {
      signal.addEventListener('abort', () => aborted.push(true))
      return new Promise<string>((resolve) => { resolveA = resolve })
    })
    const b = sequencer.run(oldScope, (signal) => {
      signal.addEventListener('abort', () => aborted.push(true))
      return new Promise<string>((resolve) => { resolveB = resolve })
    })
    const aAssertion = expect(a).rejects.toBeInstanceOf(SupersededRequestError)
    const bAssertion = expect(b).rejects.toBeInstanceOf(SupersededRequestError)

    await expect(
      sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'vehicle-2'),
    ).resolves.toBe('vehicle-2')

    // Both peers of the abandoned scope were cancelled, not just the newest.
    expect(aborted).toHaveLength(2)

    resolveA('stale-a')
    resolveB('stale-b')
    await aAssertion
    await bAssertion
  })

  it('resumes normal same-scope behaviour after a scope change', async () => {
    const sequencer = createScopeSequencer()
    await sequencer.run(scopeKey({ vehicleId: 1 }), async () => 'one')
    await sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'two')

    let resolveA: (value: string) => void = () => {}
    const a = sequencer.run(scopeKey({ vehicleId: 2 }), () =>
      new Promise<string>((resolve) => { resolveA = resolve }))
    const b = sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'b')

    await expect(b).resolves.toBe('b')
    resolveA('a')
    await expect(a).resolves.toBe('a')
  })

  it('tracks the active scope key and drains in-flight bookkeeping', async () => {
    const sequencer = createScopeSequencer()
    expect(sequencer.currentKey).toBeNull()
    expect(sequencer.inFlightCount).toBe(0)

    await sequencer.run(scopeKey({ vehicleId: 5 }), async () => 'ok')
    expect(sequencer.currentKey).toBe(JSON.stringify(scopeKey({ vehicleId: 5 })))
    expect(sequencer.inFlightCount).toBe(0)
  })

  it('drops an in-flight run from the bookkeeping even when it throws', async () => {
    const sequencer = createScopeSequencer()
    await expect(
      sequencer.run(scopeKey({ vehicleId: 1 }), async () => { throw new Error('boom') }),
    ).rejects.toThrow('boom')
    expect(sequencer.inFlightCount).toBe(0)
  })

  it('rejects a NON-COOPERATIVE never-settling task when the scope changes', async () => {
    // AbortSignal is advisory. A task that ignores it and never settles would
    // leave the caller awaiting forever for a scope the user already left —
    // a spinner that never resolves.
    const sequencer = createScopeSequencer()
    let sawAbort = false

    const stranded = sequencer.run(scopeKey({ vehicleId: 1 }), (signal) => {
      signal.addEventListener('abort', () => { sawAbort = true })
      return new Promise<string>(() => {}) // never settles, ignores the signal
    })
    const strandedAssertion = expect(stranded).rejects.toBeInstanceOf(SupersededRequestError)

    await expect(
      sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'vehicle-2'),
    ).resolves.toBe('vehicle-2')

    await strandedAssertion
    // The signal is still raised for tasks that DO cooperate.
    expect(sawAbort).toBe(true)
  })

  it('rejects a NON-COOPERATIVE never-settling task on cancel()', async () => {
    const sequencer = createScopeSequencer()
    const stranded = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>(() => {}))
    const assertion = expect(stranded).rejects.toBeInstanceOf(SupersededRequestError)
    sequencer.cancel()
    await assertion
  })

  it('rejects promptly — on microtasks alone, with no timer advancing', async () => {
    const sequencer = createScopeSequencer()
    const stranded = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>(() => {}))

    let settled: unknown = null
    void stranded.catch((error) => { settled = error })

    sequencer.cancel()

    // Drain the microtask queue only — no fake timers, no setTimeout, no real
    // waiting. The exact tick count is an implementation detail of async/await
    // desugaring, so drain a bounded number of times rather than asserting on
    // it; what matters is that NO macrotask is required.
    for (let i = 0; i < 16; i += 1) await Promise.resolve()

    expect(settled).toBeInstanceOf(SupersededRequestError)
  })

  it('tracks inFlightCount across the WRAPPER lifetime, not the task lifetime', async () => {
    const sequencer = createScopeSequencer()
    expect(sequencer.inFlightCount).toBe(0)

    const stranded = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>(() => {}))
    expect(sequencer.inFlightCount).toBe(1)

    const peer = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>(() => {}))
    expect(sequencer.inFlightCount).toBe(2)

    const a = expect(stranded).rejects.toBeInstanceOf(SupersededRequestError)
    const b = expect(peer).rejects.toBeInstanceOf(SupersededRequestError)
    sequencer.cancel()

    // Still counted until each wrapper actually settles — that is the promise
    // the caller is holding.
    expect(sequencer.inFlightCount).toBe(2)
    await a
    await b
    expect(sequencer.inFlightCount).toBe(0)
  })

  it('a LATE resolve after supersession is discarded, not delivered', async () => {
    const sequencer = createScopeSequencer()
    let resolveStale: (value: string) => void = () => {}

    const stale = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>((resolve) => { resolveStale = resolve }))
    const assertion = expect(stale).rejects.toBeInstanceOf(SupersededRequestError)

    await expect(
      sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'vehicle-2'),
    ).resolves.toBe('vehicle-2')
    await assertion

    // The abandoned task finally answers — it must change nothing.
    resolveStale('vehicle-1-rows')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sequencer.inFlightCount).toBe(0)
  })

  it('a LATE rejection after supersession never becomes an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason)
      event.preventDefault()
    }
    globalThis.addEventListener?.('unhandledrejection', onUnhandled as EventListener)

    try {
      const sequencer = createScopeSequencer()
      let rejectStale: (reason: unknown) => void = () => {}

      const stale = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
        new Promise<string>((_resolve, reject) => { rejectStale = reject }))
      const assertion = expect(stale).rejects.toBeInstanceOf(SupersededRequestError)

      await expect(
        sequencer.run(scopeKey({ vehicleId: 2 }), async () => 'vehicle-2'),
      ).resolves.toBe('vehicle-2')
      await assertion

      // The abandoned request finally fails, long after nobody is listening.
      rejectStale(new Error('socket reset for the abandoned scope'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandled).toEqual([])
    } finally {
      globalThis.removeEventListener?.('unhandledrejection', onUnhandled as EventListener)
    }
  })

  it('normalises a synchronously-throwing task into a rejection and clears bookkeeping', async () => {
    const sequencer = createScopeSequencer()
    await expect(
      sequencer.run(scopeKey({ vehicleId: 1 }), () => {
        throw new Error('sync boom')
      }),
    ).rejects.toThrow('sync boom')
    expect(sequencer.inFlightCount).toBe(0)
  })

  it('surfaces a genuine failure of the newest run unchanged', async () => {
    const sequencer = createScopeSequencer()
    await expect(
      sequencer.run(scopeKey({ vehicleId: 1 }), async () => {
        throw new Error('backend exploded')
      }),
    ).rejects.toThrow('backend exploded')
  })

  it('cancel() supersedes every in-flight run', async () => {
    const sequencer = createScopeSequencer()
    const pending = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>((resolve) => { setTimeout(() => resolve('late'), 0) }))
    const peer = sequencer.run(scopeKey({ vehicleId: 1 }), () =>
      new Promise<string>((resolve) => { setTimeout(() => resolve('late-peer'), 0) }))
    const assertion = expect(pending).rejects.toBeInstanceOf(SupersededRequestError)
    const peerAssertion = expect(peer).rejects.toBeInstanceOf(SupersededRequestError)
    sequencer.cancel()
    expect(sequencer.currentKey).toBeNull()
    await assertion
    await peerAssertion
  })
})

describe('isSupersededOrAborted', () => {
  it('recognises both cancellation shapes so callers can swallow them', () => {
    const abort = new Error('x')
    abort.name = 'AbortError'
    expect(isSupersededOrAborted(abort)).toBe(true)
    expect(isSupersededOrAborted(new SupersededRequestError())).toBe(true)
    expect(isSupersededOrAborted(new Error('real failure'))).toBe(false)
    expect(isSupersededOrAborted(null)).toBe(false)
  })
})
