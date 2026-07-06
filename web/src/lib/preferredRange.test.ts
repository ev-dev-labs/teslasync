import { describe, it, expect } from 'vitest'
import {
  selectPreferredRange,
  type PreferredRangeFields,
  type PreferredRangeResult,
} from './preferredRange'

// `selectPreferredRange` is a pure selector — no React, no settings hook, no
// network — so these are plain unit assertions over its full branch matrix:
// which field wins per `rangeType`, the null-safety of the SI-metre value, and
// the label/source metadata each branch emits.

const STATE: PreferredRangeFields = { rated_range: 400_000, ideal_range: 450_000 }

describe('selectPreferredRange — type selection', () => {
  it('uses the ideal field when the preference is exactly "ideal"', () => {
    const result = selectPreferredRange(STATE, 'ideal')
    expect(result.source).toBe('ideal')
    expect(result.meters).toBe(450_000)
  })

  it('uses the rated field when the preference is exactly "rated"', () => {
    const result = selectPreferredRange(STATE, 'rated')
    expect(result.source).toBe('rated')
    expect(result.meters).toBe(400_000)
  })

  it('defaults to rated when the preference is undefined', () => {
    expect(selectPreferredRange(STATE, undefined).source).toBe('rated')
    expect(selectPreferredRange(STATE, undefined).meters).toBe(400_000)
  })

  it('defaults to rated when the preference is null', () => {
    expect(selectPreferredRange(STATE, null).source).toBe('rated')
    expect(selectPreferredRange(STATE, null).meters).toBe(400_000)
  })

  it('defaults to rated for unknown/garbage preference strings', () => {
    expect(selectPreferredRange(STATE, 'bogus').source).toBe('rated')
    expect(selectPreferredRange(STATE, '').source).toBe('rated')
  })

  it('is case-sensitive: "Ideal"/"IDEAL" fall back to rated', () => {
    // The backend emits lowercase 'ideal'; anything else is treated as default.
    expect(selectPreferredRange(STATE, 'Ideal').source).toBe('rated')
    expect(selectPreferredRange(STATE, 'IDEAL').source).toBe('rated')
    expect(selectPreferredRange(STATE, ' ideal').source).toBe('rated')
  })
})

describe('selectPreferredRange — labels + full shape', () => {
  it('emits ideal label metadata for the ideal branch', () => {
    const result = selectPreferredRange(STATE, 'ideal')
    expect(result).toEqual<PreferredRangeResult>({
      meters: 450_000,
      source: 'ideal',
      labelKey: 'idealRange',
      defaultLabel: 'Ideal Range',
    })
  })

  it('emits rated label metadata for the rated branch', () => {
    const result = selectPreferredRange(STATE, 'rated')
    expect(result).toEqual<PreferredRangeResult>({
      meters: 400_000,
      source: 'rated',
      labelKey: 'ratedRange',
      defaultLabel: 'Rated Range',
    })
  })

  it('keeps a stable label even when the value is missing (loading state)', () => {
    // Consumers pass null/undefined state while data loads and still want a
    // stable label to render — meters is null but the label matches the pref.
    const loading = selectPreferredRange(null, 'ideal')
    expect(loading.meters).toBeNull()
    expect(loading.labelKey).toBe('idealRange')
    expect(loading.defaultLabel).toBe('Ideal Range')
  })
})

describe('selectPreferredRange — null safety of the selected value', () => {
  it('returns null meters when state is null', () => {
    expect(selectPreferredRange(null, 'rated').meters).toBeNull()
    expect(selectPreferredRange(null, 'ideal').meters).toBeNull()
  })

  it('returns null meters when state is undefined', () => {
    expect(selectPreferredRange(undefined, 'rated').meters).toBeNull()
    expect(selectPreferredRange(undefined, 'ideal').meters).toBeNull()
  })

  it('returns null when the selected field is explicitly null', () => {
    expect(selectPreferredRange({ rated_range: null }, 'rated').meters).toBeNull()
    expect(selectPreferredRange({ ideal_range: null }, 'ideal').meters).toBeNull()
  })

  it('returns null when the selected field is absent (undefined)', () => {
    expect(selectPreferredRange({}, 'rated').meters).toBeNull()
    expect(selectPreferredRange({ rated_range: 400_000 }, 'ideal').meters).toBeNull()
  })

  it('never cross-falls-back to the other field', () => {
    // Rated preferred but rated missing → null, even though ideal is present.
    const ratedMissing = selectPreferredRange({ ideal_range: 450_000 }, 'rated')
    expect(ratedMissing.meters).toBeNull()
    expect(ratedMissing.source).toBe('rated')

    // Ideal preferred but ideal missing → null, even though rated is present.
    const idealMissing = selectPreferredRange({ rated_range: 400_000 }, 'ideal')
    expect(idealMissing.meters).toBeNull()
    expect(idealMissing.source).toBe('ideal')
  })

  it('preserves a legitimate zero-metre value (not treated as missing)', () => {
    // An empty battery reports 0 m of range — that is real data, not null.
    expect(selectPreferredRange({ rated_range: 0 }, 'rated').meters).toBe(0)
    expect(selectPreferredRange({ ideal_range: 0 }, 'ideal').meters).toBe(0)
  })
})

describe('selectPreferredRange — non-finite hardening', () => {
  it('collapses NaN to null so consumers do not render "NaN km"', () => {
    expect(selectPreferredRange({ rated_range: NaN }, 'rated').meters).toBeNull()
    expect(selectPreferredRange({ ideal_range: NaN }, 'ideal').meters).toBeNull()
  })

  it('collapses Infinity and -Infinity to null', () => {
    expect(selectPreferredRange({ rated_range: Infinity }, 'rated').meters).toBeNull()
    expect(selectPreferredRange({ rated_range: -Infinity }, 'rated').meters).toBeNull()
    expect(selectPreferredRange({ ideal_range: Infinity }, 'ideal').meters).toBeNull()
  })

  it('still passes through ordinary finite values unchanged', () => {
    expect(selectPreferredRange({ rated_range: 123_456 }, 'rated').meters).toBe(123_456)
  })
})
