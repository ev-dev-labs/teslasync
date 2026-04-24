import { describe, it, expect } from 'vitest'
import { getStateBadgeColor, getStateColor, getStateLabel, isChargingState, isChargeCompleteState } from './enums'

describe('getStateBadgeColor', () => {
  it('driving → green', () => expect(getStateBadgeColor('driving')).toBe('green'))
  it('charging → amber', () => expect(getStateBadgeColor('charging')).toBe('amber'))
  it('parked → cyan', () => expect(getStateBadgeColor('parked')).toBe('cyan'))
  it('asleep → neutral', () => expect(getStateBadgeColor('asleep')).toBe('neutral'))
  it('online → green', () => expect(getStateBadgeColor('online')).toBe('green'))
  it('offline → red', () => expect(getStateBadgeColor('offline')).toBe('red'))
  it('unknown → neutral', () => expect(getStateBadgeColor('unknown')).toBe('neutral'))
  it('null → neutral', () => expect(getStateBadgeColor(null)).toBe('neutral'))
  it('undefined → neutral', () => expect(getStateBadgeColor(undefined)).toBe('neutral'))
})

describe('getStateColor', () => {
  it('driving → text-green-400', () => expect(getStateColor('driving')).toBe('text-green-400'))
  it('charging → text-cyan-400', () => expect(getStateColor('charging')).toBe('text-cyan-400'))
  it('null → text-gray-400', () => expect(getStateColor(null)).toBe('text-gray-400'))
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
