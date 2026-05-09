import { describe, it, expect } from 'vitest';
import { cleanSafetyEnum, isSafetyEnumActive } from './safetyEnum';

// ---------------------------------------------------------------------------
// safetyEnum — Phase-42a hardening
//
// Backend serializes raw signal.SignalValue (`interface{}`) so the same
// "string" enum field can arrive as string / boolean / number / null.
// These tests pin the contract that:
//   1. cleanSafetyEnum NEVER calls .startsWith on a non-string
//   2. isSafetyEnumActive NEVER mis-classifies a bare boolean false as active
//      (the regression bug was String(false).toLowerCase() !== 'off' === true)
// ---------------------------------------------------------------------------

describe('cleanSafetyEnum', () => {
  it.each([null, undefined])('nullish %p → fallback', (v) => {
    expect(cleanSafetyEnum(v, 'forward_collision_warning')).toBe('—');
  });

  it('respects custom fallback', () => {
    expect(cleanSafetyEnum(null, 'forward_collision_warning', 'Off')).toBe('Off');
    expect(cleanSafetyEnum('', 'lane_departure_avoidance', 'N/A')).toBe('N/A');
  });

  it('boolean true → "On"', () => {
    expect(cleanSafetyEnum(true, 'forward_collision_warning')).toBe('On');
  });

  it('boolean false → "Off"', () => {
    expect(cleanSafetyEnum(false, 'forward_collision_warning')).toBe('Off');
  });

  it('number 3 (legacy CruiseFollowDistance) → "3"', () => {
    expect(cleanSafetyEnum(3, 'cruise_follow_distance')).toBe('3');
  });

  it('number 0 → "0"', () => {
    expect(cleanSafetyEnum(0, 'cruise_follow_distance')).toBe('0');
  });

  it('strips ForwardCollisionSensitivity prefix', () => {
    expect(cleanSafetyEnum('ForwardCollisionSensitivityMedium', 'forward_collision_warning')).toBe('Medium');
  });

  it('strips LaneAssistLevel prefix', () => {
    expect(cleanSafetyEnum('LaneAssistLevelWarn', 'lane_departure_avoidance')).toBe('Warn');
  });

  it('strips FollowDistance prefix', () => {
    expect(cleanSafetyEnum('FollowDistance3', 'cruise_follow_distance')).toBe('3');
  });

  it('strips SpeedAssistLevel prefix; SpeedAssistLevelNone → "Off"', () => {
    expect(cleanSafetyEnum('SpeedAssistLevelChime', 'speed_limit_warning')).toBe('Chime');
    expect(cleanSafetyEnum('SpeedAssistLevelNone', 'speed_limit_warning')).toBe('Off');
  });

  it('returns string unchanged when no prefix matches', () => {
    expect(cleanSafetyEnum('Medium', 'forward_collision_warning')).toBe('Medium');
    expect(cleanSafetyEnum('3', 'cruise_follow_distance')).toBe('3');
  });

  it('does NOT crash on object/array/NaN/Infinity', () => {
    expect(cleanSafetyEnum({}, 'forward_collision_warning')).toBe('—');
    expect(cleanSafetyEnum([], 'forward_collision_warning')).toBe('—');
    expect(cleanSafetyEnum(NaN, 'cruise_follow_distance')).toBe('—');
    expect(cleanSafetyEnum(Infinity, 'cruise_follow_distance')).toBe('—');
  });
});

describe('isSafetyEnumActive (the String() anti-pattern killer)', () => {
  it('boolean true → active', () => {
    expect(isSafetyEnumActive(true, 'forward_collision_warning')).toBe(true);
  });

  it('boolean false → INACTIVE (regression: String(false)!=="off" was wrongly treating this as active)', () => {
    expect(isSafetyEnumActive(false, 'forward_collision_warning')).toBe(false);
    expect(isSafetyEnumActive(false, 'lane_departure_avoidance')).toBe(false);
    expect(isSafetyEnumActive(false, 'speed_limit_warning')).toBe(false);
    expect(isSafetyEnumActive(false, 'cruise_follow_distance')).toBe(false);
  });

  it.each([null, undefined])('nullish %p → inactive', (v) => {
    expect(isSafetyEnumActive(v, 'forward_collision_warning')).toBe(false);
  });

  it.each(['', 'Off', 'OFF', 'None', 'Disabled', '0'])('off-class string %p → inactive', (v) => {
    expect(isSafetyEnumActive(v, 'forward_collision_warning')).toBe(false);
  });

  it('SpeedAssistLevelNone → inactive (special case via cleanSafetyEnum)', () => {
    expect(isSafetyEnumActive('SpeedAssistLevelNone', 'speed_limit_warning')).toBe(false);
  });

  it.each(['Medium', 'High', 'Chime', 'Warn'])('non-off enum %p → active', (v) => {
    expect(isSafetyEnumActive(v, 'forward_collision_warning')).toBe(true);
  });

  it('legacy raw string ForwardCollisionSensitivityMedium → active', () => {
    expect(isSafetyEnumActive('ForwardCollisionSensitivityMedium', 'forward_collision_warning')).toBe(true);
  });

  it('CruiseFollowDistance number 3 → active; 0 → inactive', () => {
    expect(isSafetyEnumActive(3, 'cruise_follow_distance')).toBe(true);
    expect(isSafetyEnumActive(0, 'cruise_follow_distance')).toBe(false);
  });

  it('does NOT crash on object/array', () => {
    expect(isSafetyEnumActive({}, 'forward_collision_warning')).toBe(false);
    expect(isSafetyEnumActive([], 'forward_collision_warning')).toBe(false);
  });
});
