import { describe, it, expect } from 'vitest'
import { parseEnumBool, isCharging, isChargeComplete, parseHvacPower, parseWindowState, parseCabinOverheatMode, parseClimateKeeperMode } from './parseEnums'

describe('parseEnumBool', () => {
  it('true boolean → true', () => expect(parseEnumBool(true)).toBe(true))
  it('false boolean → false', () => expect(parseEnumBool(false)).toBe(false))
  it('"SentryModeStateArmed" → true', () => expect(parseEnumBool('SentryModeStateArmed')).toBe(true))
  it('"HvacPowerStateOff" → false', () => expect(parseEnumBool('HvacPowerStateOff')).toBe(false))
  it('"false" → false', () => expect(parseEnumBool('false')).toBe(false))
  it('"" → false', () => expect(parseEnumBool('')).toBe(false))
  it('"0" → false', () => expect(parseEnumBool('0')).toBe(false))
  it('number 42 → true', () => expect(parseEnumBool(42)).toBe(true))
  it('number 0 → false', () => expect(parseEnumBool(0)).toBe(false))
  it('null → false', () => expect(parseEnumBool(null)).toBe(false))
  it('undefined → false', () => expect(parseEnumBool(undefined)).toBe(false))
})

describe('isCharging', () => {
  it('"DetailedChargeStateCharging" → true', () => expect(isCharging('DetailedChargeStateCharging')).toBe(true))
  it('"Starting" → true', () => expect(isCharging('Starting')).toBe(true))
  it('"Enable" → true', () => expect(isCharging('Enable')).toBe(true))
  it('"Complete" → false', () => expect(isCharging('Complete')).toBe(false))
  it('"Disconnected" → false', () => expect(isCharging('Disconnected')).toBe(false))
})

describe('isChargeComplete', () => {
  it('"DetailedChargeStateComplete" → true', () => expect(isChargeComplete('DetailedChargeStateComplete')).toBe(true))
  it('"Charging" → false', () => expect(isChargeComplete('Charging')).toBe(false))
})

describe('parseHvacPower', () => {
  it('"HvacPowerStateOn" → true', () => expect(parseHvacPower('HvacPowerStateOn')).toBe(true))
  it('"HvacPowerStatePrecondition" → true', () => expect(parseHvacPower('HvacPowerStatePrecondition')).toBe(true))
  it('"HvacPowerStateOff" → false', () => expect(parseHvacPower('HvacPowerStateOff')).toBe(false))
})

describe('parseWindowState', () => {
  it('"WindowStateClosed" → "Closed"', () => expect(parseWindowState('WindowStateClosed')).toBe('Closed'))
  it('"WindowStatePartiallyOpen" → "Partial"', () => expect(parseWindowState('WindowStatePartiallyOpen')).toBe('Partial'))
  it('"WindowStateOpened" → "Open"', () => expect(parseWindowState('WindowStateOpened')).toBe('Open'))
})

describe('parseCabinOverheatMode', () => {
  it('"CabinOverheatProtectionModeStateOn" → "On"', () => expect(parseCabinOverheatMode('CabinOverheatProtectionModeStateOn')).toBe('On'))
  it('"CabinOverheatProtectionModeStateOff" → "Off"', () => expect(parseCabinOverheatMode('CabinOverheatProtectionModeStateOff')).toBe('Off'))
})

describe('parseClimateKeeperMode', () => {
  it('"ClimateKeeperModeStateOff" → "Off"', () => expect(parseClimateKeeperMode('ClimateKeeperModeStateOff')).toBe('Off'))
  it('"ClimateKeeperModeStateDog" → "Dog Mode"', () => expect(parseClimateKeeperMode('ClimateKeeperModeStateDog')).toBe('Dog Mode'))
  it('"ClimateKeeperModeStateCamp" → "Camp Mode"', () => expect(parseClimateKeeperMode('ClimateKeeperModeStateCamp')).toBe('Camp Mode'))
})
