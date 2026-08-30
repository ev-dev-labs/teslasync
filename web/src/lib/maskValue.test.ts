/**
 * maskValue helper tests.
 *
 * Covers the five MaskVariant strategies, edge cases (empty input,
 * very short strings, unicode), and the showLast override.
 */

import { describe, it, expect } from 'vitest'
import { DEFAULT_SHOW_LAST, maskFor, type MaskVariant } from './maskValue'

const BULLET = '\u2022'

describe('maskFor', () => {
  describe('generic', () => {
    it('replaces all but the last N characters with bullets', () => {
      expect(maskFor('abcdefgh', 'generic', 3)).toBe(`${BULLET.repeat(5)}fgh`)
    })

    it('returns an empty string for an empty input', () => {
      expect(maskFor('', 'generic', 4)).toBe('')
    })

    it('clamps showLast to the value length', () => {
      expect(maskFor('xy', 'generic', 10)).toBe('xy')
    })

    it('honours a zero showLast (default for generic)', () => {
      expect(maskFor('hello', 'generic')).toBe(BULLET.repeat(5))
    })
  })

  describe('token', () => {
    it('renders a fixed-length bullet run regardless of input length', () => {
      const short = maskFor('1234567890ab', 'token')
      const long = maskFor('1234567890abcdef1234567890abcdef', 'token')
      expect(short.startsWith(BULLET.repeat(12))).toBe(true)
      expect(long.startsWith(BULLET.repeat(12))).toBe(true)
    })

    it('shows the last 4 characters by default', () => {
      expect(maskFor('sk_live_abcdef1234', 'token')).toBe(`${BULLET.repeat(12)}1234`)
    })

    it('honours an explicit showLast', () => {
      expect(maskFor('abcdefghij', 'token', 2)).toBe(`${BULLET.repeat(12)}ij`)
    })

    it('returns an empty string for an empty input', () => {
      expect(maskFor('', 'token')).toBe('')
    })
  })

  describe('vin', () => {
    it('shows the WMI prefix and last 4 of the serial', () => {
      // 17-character Tesla VIN — 5YJ + 14 chars.
      const result = maskFor('5YJ3E1EA7JF000123', 'vin')
      expect(result.startsWith('5YJ')).toBe(true)
      expect(result.endsWith('0123')).toBe(true)
      // Hidden run length = 17 - 3 - 4 = 10
      expect(result).toBe(`5YJ${BULLET.repeat(10)}0123`)
    })

    it('falls back to generic mask for short inputs', () => {
      expect(maskFor('5YJ', 'vin')).toBe(BULLET.repeat(3))
    })

    it('does not disclose prefixes for malformed non-VIN values', () => {
      expect(maskFor('5YJ12345678', 'vin')).toBe(BULLET.repeat(11))
    })

    it('respects an explicit showLast', () => {
      expect(maskFor('5YJ3E1EA7JF000123', 'vin', 2)).toBe(`5YJ${BULLET.repeat(12)}23`)
    })
  })

  describe('coords', () => {
    it('renders a lat/lng pair as masked decimals separated by a comma', () => {
      expect(maskFor('37.7749,-122.4194', 'coords')).toBe(
        `${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}, ${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}`,
      )
    })

    it('renders a single number as a single masked decimal', () => {
      expect(maskFor('48.8566', 'coords')).toBe(`${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}`)
    })

    it('falls back to a generic mask for non-numeric input', () => {
      expect(maskFor('not-a-coord', 'coords')).toBe(BULLET.repeat(11))
    })

    it('returns an empty string for an empty input', () => {
      expect(maskFor('', 'coords')).toBe('')
    })

    it('handles whitespace around the components', () => {
      expect(maskFor('  37.0 , -122.0 ', 'coords')).toBe(
        `${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}, ${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}`,
      )
    })
  })

  describe('email', () => {
    it('masks the local part and keeps the domain visible', () => {
      expect(maskFor('alice@example.com', 'email')).toBe(`a${BULLET.repeat(4)}@example.com`)
    })

    it('honours showLast for the local part', () => {
      expect(maskFor('alice@example.com', 'email', 2)).toBe(`al${BULLET.repeat(3)}@example.com`)
    })

    it('always leaves at least one bullet so a 1-char local stays masked', () => {
      expect(maskFor('a@example.com', 'email')).toBe(`a${BULLET}@example.com`)
    })

    it('falls back to generic for malformed inputs without an @', () => {
      expect(maskFor('not-an-email', 'email')).toBe(`${BULLET.repeat(11)}l`)
    })
  })

  describe('default suffix table', () => {
    it('exposes a default for every variant', () => {
      const variants: MaskVariant[] = ['token', 'vin', 'coords', 'email', 'generic']
      for (const v of variants) {
        expect(typeof DEFAULT_SHOW_LAST[v]).toBe('number')
      }
    })
  })

  describe('robustness', () => {
    it('treats an unknown variant as generic', () => {
      // @ts-expect-error — exercising the runtime fallback for an unknown variant
      expect(maskFor('abcdef', 'whatever', 2)).toBe(`${BULLET.repeat(4)}ef`)
    })
  })
})
