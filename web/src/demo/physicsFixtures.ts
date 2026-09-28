import type { PhysicsLedger, PhysicsTerm } from '@/api/types'
import type { GearTheater, SilentReport } from '@/types/teslaPhysics'
import { drives } from './fixtures'

type FixtureResult = { status: number; body: unknown }
type DemoDrive = (typeof drives)[number]

const found = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (): FixtureResult => ({
  status: 400, body: { error: 'Invalid demo physics drive ID or filters', code: 'INVALID_FILTER' },
})
const missing = (): FixtureResult => ({
  status: 404, body: { error: 'Demo drive not found', code: 'NOT_FOUND' },
})
const at = (drive: DemoDrive, seconds: number) =>
  new Date(Date.parse(drive.start_ts) + seconds * 1000).toISOString()
const round = (value: number) => Math.round(value * 100) / 100
const term = (value: number, method: string): PhysicsTerm => ({
  value_wh: round(value), method, unknown: false,
})

function theater(drive: DemoDrive): GearTheater {
  return {
    drive_id: drive.id,
    vehicle_id: drive.vehicle_id,
    events: [
      { at: drive.start_ts, gear: 'D', charge_port_door_open: false, charge_port_latch: 'Engaged' },
      { at: drive.end_ts, gear: 'P', charge_port_door_open: false, charge_port_latch: 'Engaged' },
    ],
    honesty: 'Synthetic shift observations at session boundaries; P/R/N/D and charge-port states are not GPS positions.',
  }
}

function silent(drive: DemoDrive): SilentReport {
  const startedS = 720
  const endedS = 840
  return {
    drive_id: drive.id,
    vehicle_id: drive.vehicle_id,
    intervals: [{
      started_at: at(drive, startedS),
      ended_at: at(drive, endedS),
      duration_s: endedS - startedS,
      gear: 'D',
      fsd_distance_m: drive.id * 100,
      label: 'counter silent',
    }],
    unknown: false,
    honesty: 'Synthetic FSD trip-meter observations: a frozen counter while moving is not a disengagement or proof of FSD use.',
  }
}

function ledger(drive: DemoDrive): PhysicsLedger {
  const massKg = drive.vehicle_id === 8 ? 1850 : 1950
  const cruiseMps = drive.distance_m / (drive.duration_s - 60)
  const cdaM2 = 0.575
  const crr = 0.009
  const aeroWh = 0.5 * 1.225 * cdaM2 * cruiseMps ** 2 * drive.distance_m / 3600
  const rollingWh = massKg * 9.80665 * crr * drive.distance_m / 3600
  const accessoryWh = 1200 * drive.duration_s / 3600
  const lossWh = (aeroWh + rollingWh) * (1 / 0.9 - 1)
  const inertialWh = drive.regen_energy_wh * 0.25
  const predictedWh = round(aeroWh + rollingWh + accessoryWh + lossWh + inertialWh)
  const regenWh = drive.regen_energy_wh
  const frictionWh = round(regenWh * 0.18)
  const speedAt = (seconds: number) => Math.min(1, seconds / 60, (drive.duration_s - seconds) / 60) * cruiseMps
  const accelAt = (seconds: number) =>
    seconds < 60 ? cruiseMps / 60 : seconds > drive.duration_s - 60 ? -cruiseMps / 60 : 0
  const forceAt = (seconds: number) => {
    const speed = speedAt(seconds)
    return massKg * accelAt(seconds) + massKg * 9.80665 * crr
      + 0.5 * 1.225 * cdaM2 * speed ** 2
  }
  const powerAt = (seconds: number) => round(forceAt(seconds) * speedAt(seconds))
  const point = (seconds: number) => ({
    at: at(drive, seconds),
    speed_mps: round(speedAt(seconds)),
    accel_mps2: round(accelAt(seconds)),
    force_long_n: round(forceAt(seconds)),
    power_mech_w: powerAt(seconds),
    power_pack_w: round(powerAt(seconds) >= 0
      ? powerAt(seconds) / 0.9 + 1200 : powerAt(seconds) * 0.9 + 1200),
    friction_brake_w: seconds === drive.duration_s - 30 ? round(frictionWh * 3600 / 60) : 0,
    unknown: false,
  })
  const points = [0, 30, 60, drive.duration_s / 2, drive.duration_s - 60,
    drive.duration_s - 30, drive.duration_s].map(point)
  const blackBox = [drive.duration_s - 90, drive.duration_s - 60,
    drive.duration_s - 30, drive.duration_s].map(seconds => ({
    at: at(drive, seconds),
    speed_mps: round(speedAt(seconds)),
    power_pack_w: point(seconds).power_pack_w,
    force_long_n: round(forceAt(seconds)),
    latch: 'Engaged',
  }))
  const remainingWh = round(drive.end_soc_pct * 780)
  const ratedM = round(410_000 * drive.end_soc_pct / 100)
  const estM = round(ratedM * 0.95)
  const idealM = round(ratedM * 1.05)
  const tireBase = drive.vehicle_id === 8 ? 290 : 295

  return {
    vehicle_id: drive.vehicle_id, kind: 'drive',
    start: drive.start_ts, end: drive.end_ts,
    dynamics: {
      points, mass_kg: massKg, mass_source: 'default',
      regen_wh: regenWh, friction_brake_wh: frictionWh,
      unknown: false,
      honesty: 'Fictional force/speed model and session-derived regen; mass, braking and power are synthetic, not measured telemetry.',
    },
    drive: {
      measured_wh: term(drive.energy_used_wh, 'Synthetic pack estimate anchored to demo session energy'),
      session_wh: drive.energy_used_wh, reconcile_wh: 0,
      aero_wh: term(aeroWh, 'Modeled drag: ½ρCdA v² over session distance'),
      rolling_wh: term(rollingWh, 'Modeled rolling resistance: mass × g × Crr × distance'),
      grade_wh: term(0, 'Synthetic level route; no observed elevation'),
      inertial_wh: term(inertialWh, 'Modeled unrecovered stop-and-go energy'),
      accessory_wh: term(accessoryWh, 'Synthetic 1.2 kW accessory load over drive duration'),
      drivetrain_loss_wh: term(lossWh, 'Modeled 90% drivetrain efficiency'),
      predicted_wh: predictedWh,
      unexplained_wh: round(drive.energy_used_wh - predictedWh),
      unexplained_known: true,
      honesty: 'Fictional model versus fictional session energy; residual is a model difference, not observed loss.',
    },
    charge: null, park: null,
    thermal: {
      pack_min_c: 23, pack_max_c: 28, pack_start_c: 23, pack_end_c: 27,
      inside_c: drive.inside_temp_avg_c, outside_c: drive.outside_temp_avg_c,
      heat_vs_power_r: null, unknown: false,
      honesty: 'Synthetic pack temperatures; cabin and ambient are drawn from the demo drive. No causal heat/power inference.',
    },
    range: {
      rated_m: ratedM, est_m: estM, ideal_m: idealM, energy_wh: remainingWh,
      implied_wh_per_m: round(remainingWh / ratedM), spread_m: round(idealM - estM),
      disagree: true, unknown: false,
      honesty: 'Fictional rated/estimated/ideal range derived from ending SoC; no single range is ground truth.',
    },
    tires: {
      fl_kpa: tireBase, fr_kpa: tireBase + 2, rl_kpa: tireBase - 1,
      rr_kpa: tireBase + 1, imbalance_kpa: 3, unknown: false,
      honesty: 'Fictional four-corner tire readings in kPa, not recorded TPMS.',
    },
    epochs: [{
      firmware: 'demo-firmware', measured_wh: drive.energy_used_wh,
      predicted_wh: predictedWh, unexplained_wh: round(drive.energy_used_wh - predictedWh),
      sample_count: points.length,
      honesty: 'Single fictional firmware baseline; correlation is not proof of a fix.',
    }],
    unknown_intervals: [], unknown_hours: 0,
    black_box: blackBox,
    markers: [
      { at: drive.start_ts, kind: 'drive', id: drive.id, edge: 'start' },
      { at: drive.end_ts, kind: 'drive', id: drive.id, edge: 'end' },
    ],
    truncated: false,
    honesty: 'Synthetic drive physics modeled from demo fixtures; all sampled values are fictional, not signal_log telemetry.',
  }
}

/** Returns undefined only for paths outside the three drive-physics read endpoints. */
export function physicsFixtures(path: string, params: URLSearchParams): FixtureResult | undefined {
  const match = /^\/physics\/drives\/([^/]+)\/(theater|silent|ledger)$/.exec(path)
  if (!match) return undefined
  const id = match[1]
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || [...params.keys()].length) {
    return invalid()
  }
  const drive = drives.find(row => row.id === Number(id))
  if (!drive) return missing()
  if (match[2] === 'theater') return found(theater(drive))
  if (match[2] === 'silent') return found(silent(drive))
  return found(ledger(drive))
}
