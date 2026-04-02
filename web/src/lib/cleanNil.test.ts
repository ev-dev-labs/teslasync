import { cleanNil } from './cleanNil'

describe('cleanNil', () => {
  it('returns undefined for null', () => {
    expect(cleanNil(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(cleanNil(undefined)).toBeUndefined()
  })

  it('returns undefined for the Go "<nil>" string', () => {
    expect(cleanNil('<nil>')).toBeUndefined()
  })

  it('returns undefined for "nil"', () => {
    expect(cleanNil('nil')).toBeUndefined()
  })

  it('returns undefined for "null"', () => {
    expect(cleanNil('null')).toBeUndefined()
  })

  it('returns undefined for empty string (falsy)', () => {
    expect(cleanNil('')).toBeUndefined()
  })

  it('preserves a normal string', () => {
    expect(cleanNil('hello')).toBe('hello')
  })

  it('preserves the string "0"', () => {
    expect(cleanNil('0')).toBe('0')
  })

  it('preserves the string "false"', () => {
    expect(cleanNil('false')).toBe('false')
  })

  it('preserves whitespace-only strings', () => {
    expect(cleanNil('  ')).toBe('  ')
  })
})
