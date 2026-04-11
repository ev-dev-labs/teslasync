import { describe, it, expect } from 'vitest'
import { getStateBadgeColor, getStateColor, getStateLabel, isChargingState, isChargeCompleteState } from './enums'

describe('getStateBadgeColor', () => {
  it('driving → green', () => expect(getStateBadgeColor('driving')).toBe('green'))
  it('charging → amber', () => expect(getStateBadgeColor('charging')).toBe('amber'))
  it('parked → cyan', () => expect(getStateBadgeColor('parked')).toBe('cyan'))
  it('asleep → purple', () => expect(getStateBadgeColor('asleep')).toBe('purple'))
  it('online → cyan', () => expect(getStateBadgeColor('online')).toBe('cyan'))
  it('offline → neutral', () => expect(getStateBadgeColor('offline')).toBe('neutral'))
  it('unknown → neutral', () => expect(getStateBadgeColor('unknown')).toBe('neutral'))
  it('null → neutral', () => expect(getStateBadgeColor(null)).toBe('neutral'))
  it('undefined → neutral', () => expect(getStateBadgeColor(undefined)).toBe('neutral'))
})

describe('getStateColor', () => {
  it('driving → text-neon-green', () => expect(getStateColor('driving')).toBe('text-neon-green'))
  it('charging → text-neon-amber', () => expect(getStateColor('charging')).toBe('text-neon-amber'))
  it('null → muted', () => expect(getStateColor(null)).toBe('text-[var(--text-muted)]'))
})

describe('getStateLabel', () => {
  it('driving → Driving', () => expect(getStateLabel('driving')).toBe('Driving'))
  it('charging → Charging', () => expect(getStateLabel('charging')).toBe('Charging'))
  it('asleep → Asleep', () => expect(getStateLabel('asleep')).toBe('Asleep'))
  it('null → Unknown', () => expect(getStateLabel(null)).toBe('Unknown'))
})

describe('isChargingState', () => {
  it('"Charging" → true', () => expect(isChargingState('Charging')).toBe(true))
  it('"Starting" → true', () => expect(isChargingState('Starting')).toBe(true))
  it('"Complete" → false', () => expect(isChargingState('Complete')).toBe(false))
})

describe('isChargeCompleteState', () => {
  it('"Complete" → true', () => expect(isChargeCompleteState('Complete')).toBe(true))
  it('"Charging" → false', () => expect(isChargeCompleteState('Charging')).toBe(false))
})
