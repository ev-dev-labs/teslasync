import { describe, it, expect, afterEach } from 'vitest'
import { safeRandomUUID } from '../safeUUID'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ORIGINAL_CRYPTO = globalThis.crypto

function setCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value,
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: ORIGINAL_CRYPTO,
  })
})

describe('safeRandomUUID', () => {
  it('returns a v4 UUID using crypto.randomUUID when available', () => {
    setCrypto({
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      getRandomValues: () => {
        throw new Error('should not be called')
      },
    })
    expect(safeRandomUUID()).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('falls back to crypto.getRandomValues when randomUUID is missing (non-secure context)', () => {
    let called = false
    setCrypto({
      /* randomUUID intentionally absent — simulates http://192.168.x.y access */
      getRandomValues: (bytes: Uint8Array) => {
        called = true
        for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1
        return bytes
      },
    })
    const id = safeRandomUUID()
    expect(called).toBe(true)
    expect(id).toMatch(UUID_V4_RE)
  })

  it('falls back to Math.random when crypto is entirely unavailable', () => {
    setCrypto(undefined)
    const id = safeRandomUUID()
    expect(id).toMatch(UUID_V4_RE)
  })

  it('does not crash when crypto property access throws (ITP / locked iframe)', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    expect(() => safeRandomUUID()).not.toThrow()
    expect(safeRandomUUID()).toMatch(UUID_V4_RE)
  })

  it('produces unique IDs across consecutive calls', () => {
    /* Use the real host crypto if present so this doubles as a smoke
     * test that the production-secure-context path also works. */
    const a = safeRandomUUID()
    const b = safeRandomUUID()
    expect(a).not.toBe(b)
    expect(a).toMatch(UUID_V4_RE)
    expect(b).toMatch(UUID_V4_RE)
  })
})
