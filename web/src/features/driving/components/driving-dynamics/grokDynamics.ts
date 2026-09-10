import type { DriveDynamicsSnapshot, MotorSnapshot } from '@/api/types';

/**
 * Grok's live powertrain read — derived only from measured motor + chassis
 * signals. This is not Autopilot state, not the Tesla chassis controller,
 * and not a claim about 0–60 or grip used.
 */

export type GrokMode =
  | 'unknown'
  | 'parked'
  | 'idle'
  | 'regen'
  | 'blended_brake'
  | 'launch'
  | 'cornering'
  | 'drive';

export type GrokTone = 'info' | 'positive' | 'caution';

export type GrokThermal = 'unknown' | 'cool' | 'warm' | 'hot';

export type GrokFindingId =
  | 'parked'
  | 'idle'
  | 'regen_harvest'
  | 'one_pedal'
  | 'blended_brake'
  | 'launch'
  | 'drive'
  | 'cornering'
  | 'awd_rear'
  | 'awd_front'
  | 'awd_balanced'
  | 'thermal_warm'
  | 'thermal_hot';

export interface GrokFinding {
  id: GrokFindingId;
  tone: GrokTone;
}

export interface GrokDynamicsRead {
  mode: GrokMode;
  hasSignal: boolean;
  torqueTotalNm: number | null;
  rearTorqueSharePct: number | null;
  drivePowerW: number | null;
  regenPowerW: number | null;
  combinedG: number | null;
  lateralG: number | null;
  longitudinalG: number | null;
  thermal: GrokThermal;
  maxMotorTempC: number | null;
  findings: GrokFinding[];
}

/** Same stator bands as LiveMotorStatus — cruise-warm vs derate neighborhood. */
export const MOTOR_TEMP_WARM_C = 80;
export const MOTOR_TEMP_HOT_C = 120;

const IDLE_TORQUE_NM = 20;
const REGEN_TORQUE_NM = -40;
const REGEN_POWER_W = 2_000;
const LAUNCH_PEDAL_PCT = 80;
const LAUNCH_TORQUE_NM = 400;
const LAUNCH_LONG_G = 0.4;
const CORNER_LAT_G = 0.35;
const SPLIT_MIN_NM = 1;

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function kwToWatts(kw: number | null | undefined): number | null {
  const value = finite(kw);
  return value == null ? null : value * 1000;
}

function maxTempC(motor: MotorSnapshot | null | undefined): number | null {
  const candidates = [
    finite(motor?.motor_temp_c_front),
    finite(motor?.motor_temp_c_rear),
    finite(motor?.inverter_temp_c),
    finite(motor?.inverter_temp_rear),
  ].filter((value): value is number => value != null);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function classifyThermal(tempC: number | null): GrokThermal {
  if (tempC == null) return 'unknown';
  if (tempC >= MOTOR_TEMP_HOT_C) return 'hot';
  if (tempC >= MOTOR_TEMP_WARM_C) return 'warm';
  return 'cool';
}

function classifyGear(shiftState: string | null | undefined): 'park' | 'other' {
  const gear = (shiftState ?? '').trim().toUpperCase();
  if (gear === 'P' || gear.startsWith('PARK')) return 'park';
  return 'other';
}

export function rearTorqueSharePct(
  frontNm: number | null,
  rearNm: number | null,
): number | null {
  if (frontNm == null && rearNm == null) return null;
  const front = Math.abs(frontNm ?? 0);
  const rear = Math.abs(rearNm ?? 0);
  const sum = front + rear;
  if (sum < SPLIT_MIN_NM) return null;
  return (rear / sum) * 100;
}

function classifyMode(input: {
  hasSignal: boolean;
  gear: 'park' | 'other';
  torqueTotalNm: number | null;
  regenPowerW: number | null;
  pedalPct: number | null;
  brakeActive: boolean | null;
  lateralG: number | null;
  longitudinalG: number | null;
}): GrokMode {
  if (!input.hasSignal) return 'unknown';
  if (input.gear === 'park') return 'parked';

  const regen = (input.regenPowerW ?? 0) >= REGEN_POWER_W
    || (input.torqueTotalNm ?? 0) <= REGEN_TORQUE_NM;
  if (input.brakeActive === true && regen) return 'blended_brake';
  if (regen) return 'regen';

  const launching = (input.pedalPct ?? 0) >= LAUNCH_PEDAL_PCT
    && (input.torqueTotalNm ?? 0) >= LAUNCH_TORQUE_NM
    && (input.longitudinalG == null || input.longitudinalG >= LAUNCH_LONG_G);
  if (launching) return 'launch';

  if (Math.abs(input.lateralG ?? 0) >= CORNER_LAT_G) return 'cornering';

  const quiet = Math.abs(input.torqueTotalNm ?? 0) < IDLE_TORQUE_NM
    && (input.pedalPct == null || input.pedalPct < 5);
  if (quiet) return 'idle';

  return 'drive';
}

/**
 * Interpret the latest motor snapshot plus drive-dynamics projection.
 * Missing axes stay unknown — they are never coerced to zero.
 */
export function interpretGrokDynamics(
  motor: MotorSnapshot | null | undefined,
  dynamics: DriveDynamicsSnapshot | null | undefined,
): GrokDynamicsRead {
  const torqueFront = finite(motor?.torque_nm_front);
  const torqueRear = finite(motor?.torque_nm_rear);
  const torqueTotalNm = torqueFront == null && torqueRear == null
    ? null
    : (torqueFront ?? 0) + (torqueRear ?? 0);

  const drivePowerW = kwToWatts(motor?.power_kw);
  const regenPowerW = kwToWatts(motor?.regen_kw);
  const pedalPct = finite(dynamics?.pedal_position);
  const brakeActive = typeof dynamics?.brake_pedal_active === 'boolean'
    ? dynamics.brake_pedal_active
    : null;
  const lateralG = finite(dynamics?.lateral_acceleration);
  const longitudinalG = finite(dynamics?.longitudinal_acceleration);
  const combinedG = lateralG != null && longitudinalG != null
    ? Math.sqrt(lateralG * lateralG + longitudinalG * longitudinalG)
    : null;
  const maxMotorTempC = maxTempC(motor);
  const thermal = classifyThermal(maxMotorTempC);
  const share = rearTorqueSharePct(torqueFront, torqueRear);

  const hasSignal = [
    torqueTotalNm,
    drivePowerW,
    regenPowerW,
    pedalPct,
    brakeActive,
    lateralG,
    longitudinalG,
    maxMotorTempC,
    motor?.shift_state,
  ].some((value) => value != null && value !== '');

  const mode = classifyMode({
    hasSignal,
    gear: classifyGear(motor?.shift_state),
    torqueTotalNm,
    regenPowerW,
    pedalPct,
    brakeActive,
    lateralG,
    longitudinalG,
  });

  const findings: GrokFinding[] = [];
  if (mode === 'parked') findings.push({ id: 'parked', tone: 'info' });
  if (mode === 'idle') findings.push({ id: 'idle', tone: 'info' });
  if (mode === 'regen') findings.push({ id: 'regen_harvest', tone: 'positive' });
  if (mode === 'blended_brake') findings.push({ id: 'blended_brake', tone: 'caution' });
  if (mode === 'launch') findings.push({ id: 'launch', tone: 'info' });
  if (mode === 'drive') findings.push({ id: 'drive', tone: 'info' });
  if (mode === 'cornering') findings.push({ id: 'cornering', tone: 'info' });

  if (mode === 'regen' && brakeActive === false) {
    findings.push({ id: 'one_pedal', tone: 'positive' });
  }

  if (share != null) {
    if (share > 60) findings.push({ id: 'awd_rear', tone: 'info' });
    else if (share < 40) findings.push({ id: 'awd_front', tone: 'info' });
    else findings.push({ id: 'awd_balanced', tone: 'positive' });
  }

  if (thermal === 'hot') findings.push({ id: 'thermal_hot', tone: 'caution' });
  else if (thermal === 'warm') findings.push({ id: 'thermal_warm', tone: 'caution' });

  return {
    mode,
    hasSignal,
    torqueTotalNm,
    rearTorqueSharePct: share,
    drivePowerW,
    regenPowerW,
    combinedG,
    lateralG,
    longitudinalG,
    thermal,
    maxMotorTempC,
    findings,
  };
}
